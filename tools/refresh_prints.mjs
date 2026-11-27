// Picture prints for "Seen it before?" (assets/osap-seenit.js, rules prints-v1). One run: reads the news OSAP holds on main
// (data/live/news/*.js and data/live/news/us-states/*.js, and the picture cache data/live/news-pics.json), downloads each news
// picture it has not printed yet (newest stories first, at most PRINTS_MAX a run), prints it with tools/prints_lib.mjs and lets
// the picture go. Only the prints and each story's line are kept; never the picture.
// Run by .github/workflows/refresh-prints.yml, or by hand with Node 20+ from the repo root (sharp installed):
//   node tools/refresh_prints.mjs OUT_DIR [PREV_DIR]
// PREV_DIR holds the last published files; OUT_DIR gets the new set (published to the live-prints branch as one commit):
//   index.json  { schema, rules, built, views, n, stories, shards: [{ id, n, bin, refs, chunk }], run: { counts } }
//   p/<id>.bin  rows of 16 bytes (pHash then dHash), views.length rows per picture, in the order pictures were added
//   r/<id>/<k>.json  the story lines of pictures k*chunk .. (k+1)*chunk-1 of that shard:
//               [date "YYYY-MM-DDTHH:MM" (or "YYYY-MM-DD"), country page, outlet, link, title, English title or "", 1 if state
//               media, the outlet's picture link (shown beside the user's photo)]
//   state.json the job's memory (never read by the page): picture and story keys done, pictures that failed and when.
// A shard is a month of ADDING (when OSAP printed the picture), so files only grow at the end. A picture seen again in a new
// story is not downloaded again: its rows are copied with the new story's line, which is how reuse shows up.
// Logs carry counts only, never headlines or links.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { C, indexPrints, MAX_BYTES } from "./prints_lib.mjs";

export const STATE_SCHEMA = "osap-prints-state/1", CHUNK = 1000, MAX_STORIES = 40, FAIL_KEEP_D = 30, FAIL_RETRY_H = 20, MAX_TRIES = 2;
const UA = "AXIOM-OSAP/1.0 (picture prints for 'Seen it before?'; https://osap.axiom-intelligence-systems.com)";
const key = (s) => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 16);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } };
const clip = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const okUrl = (u) => typeof u === "string" && /^https:\/\/[^\s<>"']{8,600}$/i.test(u);

// every story with a picture, from the news files and the picture cache: [{ img, ref }], newest first, one per (story link)
// Stories from hidden areas (tools/hidden-areas.json, Settings > Hidden areas) are left out: this archive is published plainly.
export function stories(root = ".") {
  const out = new Map();
  let hidden = new Set(); try { hidden = new Set(JSON.parse(fs.readFileSync(path.join(root, "tools/hidden-areas.json"), "utf8")).hidden || []); } catch (e) {}
  const dirs = [path.join(root, "data/live/news"), path.join(root, "data/live/news/us-states")];
  for (const d of dirs) {
    let files = []; try { files = fs.readdirSync(d).filter((f) => f.endsWith(".js")); } catch (e) {}
    for (const f of files) {
      let j = null; try { const t = fs.readFileSync(path.join(d, f), "utf8"); j = JSON.parse(t.slice(t.indexOf("=") + 1).replace(/;\s*$/, "")); } catch (e) { continue; }
      for (const [cc, list] of Object.entries((j && j.items) || {})) for (const i of Array.isArray(list) ? list : []) {
        if (!i || typeof i !== "object" || hidden.has(cc) || hidden.has(String(cc).split("-")[0])) continue;
        if (!okUrl(i.img) || !okUrl(i.link) || out.has(i.link)) continue;
        out.set(i.link, { img: i.img, ref: [clip(i.date, 16), clip(cc, 12), clip(i.outlet, 80), i.link, clip(i.title, 300), i.title_en && i.title_en !== i.title ? clip(i.title_en, 300) : "", i.state ? 1 : 0, i.img] });
      }
    }
  }
  const pics = readJson(path.join(root, "data/live/news-pics.json")) || {};
  for (const [link, e] of Object.entries(pics)) {
    if (!Array.isArray(e) || !okUrl(e[0]) || !okUrl(link) || out.has(link)) continue;
    out.set(link, { img: e[0], ref: [clip(e[1], 10), "", C.host(link), link, "", "", 0, e[0]] });
  }
  return [...out.values()].sort((a, b) => (b.ref[0] > a.ref[0] ? 1 : b.ref[0] < a.ref[0] ? -1 : 0));
}

// download one picture: https only, image/* only, at most MAX_BYTES (stopped while reading), 10 s
export async function fetchPicture(url, timeoutMs = 10000) {
  const r = await fetch(url, { redirect: "follow", headers: { "user-agent": UA, accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok || !r.body) throw new Error("HTTP " + r.status);
  if (!/^https:/i.test(r.url || url)) throw new Error("not https");
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  if (ct && !/^image\//.test(ct) && !/octet-stream/.test(ct)) throw new Error("not a picture");
  if (+r.headers.get("content-length") > MAX_BYTES) throw new Error("too large");
  const rd = r.body.getReader(), parts = []; let n = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > MAX_BYTES) { try { await rd.cancel(); } catch (e) {} throw new Error("too large"); } parts.push(value); }
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}

export function emptyState() { return { schema: STATE_SCHEMA, rules: C.RULES, pics: {}, links: {}, fail: {}, cnt: {} }; }

// the archive: prev files loaded into memory, new pictures appended, written out whole
export function loadArchive(prev) {
  const ix = prev && readJson(path.join(prev, "index.json"));
  let state = prev && readJson(path.join(prev, "state.json"));
  const shards = new Map();
  if (!ix || ix.schema !== C.SCHEMA || ix.rules !== C.RULES || !state || state.schema !== STATE_SCHEMA || state.rules !== C.RULES) return { shards, state: emptyState() };
  for (const s of ix.shards || []) {
    let bin = null; try { bin = fs.readFileSync(path.join(prev, s.bin)); } catch (e) { return { shards: new Map(), state: emptyState() }; }
    const refs = [];
    for (let k = 0; k * s.chunk < s.n; k++) { const r = readJson(path.join(prev, s.refs, k + ".json")); if (!Array.isArray(r)) return { shards: new Map(), state: emptyState() }; refs.push(...r); }
    if (refs.length !== s.n || bin.length !== s.n * 16 * C.VIEWS.length) return { shards: new Map(), state: emptyState() };
    shards.set(s.id, { id: s.id, bins: [bin], refs });
  }
  return { shards, state };
}

export function addPicture(arch, id, rows, ref) {
  if (!arch.shards.has(id)) arch.shards.set(id, { id, bins: [], refs: [] });
  const s = arch.shards.get(id), b = Buffer.alloc(16 * rows.length);
  rows.forEach((r, i) => Buffer.from(C.rowBytes(r.p, r.d)).copy(b, i * 16));
  s.bins.push(b); s.refs.push(ref);
  return [id, s.refs.length - 1];
}
export function rowsOf(arch, at) {
  const s = arch.shards.get(at[0]); if (!s) return null;
  if (s.bins.length > 1) s.bins = [Buffer.concat(s.bins)];
  const per = C.VIEWS.length, o = at[1] * 16 * per, b = s.bins[0];
  if (!b || o + 16 * per > b.length) return null;
  const hexOf = (u) => Buffer.from(u).toString("hex"), rows = [];
  for (let v = 0; v < per; v++) rows.push({ p: hexOf(b.subarray(o + v * 16, o + v * 16 + 8)), d: hexOf(b.subarray(o + v * 16 + 8, o + v * 16 + 16)) });
  return rows;
}

export function writeArchive(arch, out, meta) {
  fs.mkdirSync(path.join(out, "p"), { recursive: true });
  const shards = [], ids = [...arch.shards.keys()].sort();
  let n = 0;
  for (const id of ids) {
    const s = arch.shards.get(id), bin = Buffer.concat(s.bins), rdir = path.join("r", id);
    fs.writeFileSync(path.join(out, "p", id + ".bin"), bin);
    fs.mkdirSync(path.join(out, rdir), { recursive: true });
    for (let k = 0; k * CHUNK < s.refs.length; k++) fs.writeFileSync(path.join(out, rdir, k + ".json"), JSON.stringify(s.refs.slice(k * CHUNK, (k + 1) * CHUNK)));
    shards.push({ id, n: s.refs.length, bin: "p/" + id + ".bin", refs: rdir + "/", chunk: CHUNK, from: s.refs.reduce((m, r) => (!m || r[0] < m ? r[0] : m), ""), to: s.refs.reduce((m, r) => (r[0] > m ? r[0] : m), "") });
    n += s.refs.length;
  }
  const firstAdded = arch.state.first || meta.built;
  arch.state.first = firstAdded;
  const index = { schema: C.SCHEMA, rules: C.RULES, built: meta.built, since: firstAdded, views: C.VIEWS, n, pictures: Object.values(arch.state.pics).filter(Array.isArray).length, shards, run: meta.run };
  fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(index));
  fs.writeFileSync(path.join(out, "state.json"), JSON.stringify(arch.state));
  return index;
}

async function main() {
  const [OUT, PREV] = process.argv.slice(2);
  if (!OUT) { console.error("usage: node tools/refresh_prints.mjs OUT_DIR [PREV_DIR]"); process.exit(2); }
  const MAX = +process.env.PRINTS_MAX || 3000, STOP_MS = (+process.env.PRINTS_MINUTES || 18) * 6e4, CONC = +process.env.PRINTS_CONC || 12, now = Date.now(), built = new Date(now).toISOString().slice(0, 16) + "Z";
  const arch = loadArchive(PREV), st = arch.state, id = built.slice(0, 7);
  st.cnt = st.cnt || {};
  // forget failures after FAIL_KEEP_D days (they may be readable again)
  for (const [k, f] of Object.entries(st.fail)) if (now - Date.parse(f[1]) > FAIL_KEEP_D * 864e5) delete st.fail[k];
  const all = stories();
  const c = { stories: all.length, known: 0, reused: 0, todo: 0, printed: 0, flat: 0, failed: 0, skipped_fail: 0, capped: 0, over_cap: 0, why: {} };
  const todo = [];
  for (const s of all) {
    const lk = key(s.ref[3]); if (st.links[lk]) { c.known++; continue; }
    const pk = key(s.img);
    if (st.pics[pk]) { // a picture already printed, in a new story: copy its rows (no download)
      if (st.pics[pk] === "flat") { st.links[lk] = 1; continue; }
      // an outlet's standard picture (a logo or placeholder on every story) stops gaining story lines at MAX_STORIES
      if ((st.cnt[pk] || 1) >= MAX_STORIES) { st.links[lk] = 1; c.over_cap++; continue; }
      const rows = rowsOf(arch, st.pics[pk]);
      if (rows) { addPicture(arch, id, rows, s.ref); st.links[lk] = 1; st.cnt[pk] = (st.cnt[pk] || 1) + 1; c.reused++; }
      continue;
    }
    const f = st.fail[pk];
    if (f && (f[0] >= MAX_TRIES || now - Date.parse(f[1]) < FAIL_RETRY_H * 36e5)) { c.skipped_fail++; continue; }
    todo.push({ s, lk, pk });
  }
  // the same picture in several new stories in this run: download once, add every story
  const byPic = new Map(); for (const t of todo) { if (!byPic.has(t.pk)) byPic.set(t.pk, []); byPic.get(t.pk).push(t); }
  const queue = [...byPic.values()];
  c.todo = queue.length; c.capped = Math.max(0, queue.length - MAX);
  queue.length = Math.min(queue.length, MAX);
  let next = 0;
  async function worker() {
    while (next < queue.length && Date.now() - now < STOP_MS) { // stop taking new pictures in time to publish
      const group = queue[next++], t0 = group[0];
      try {
        const buf = await fetchPicture(t0.s.img);
        const ip = await indexPrints(buf);
        if (ip.flat) { st.pics[t0.pk] = "flat"; for (const t of group) st.links[t.lk] = 1; c.flat++; continue; }
        // stories in time order, earliest first, so the first row of a picture is its earliest story OSAP holds
        group.sort((a, b) => (a.s.ref[0] < b.s.ref[0] ? -1 : a.s.ref[0] > b.s.ref[0] ? 1 : 0));
        let at = null, k = 0;
        for (const t of group) { st.links[t.lk] = 1; if (k >= MAX_STORIES) { c.over_cap++; continue; } const a = addPicture(arch, id, ip.rows, t.s.ref); if (!at) at = a; k++; }
        st.pics[t0.pk] = at; st.cnt[t0.pk] = k; c.printed++;
        delete st.fail[t0.pk];
      } catch (e) {
        const f = st.fail[t0.pk] || [0, ""]; st.fail[t0.pk] = [f[0] + 1, new Date(now).toISOString()]; c.failed++;
        const why = /HTTP \d+/.exec(String(e && e.message))?.[0] || (/timeout|abort/i.test(String(e && (e.name + e.message))) ? "timeout" : /too large|not a picture|not https|too small/.exec(String(e && e.message))?.[0] || "unreadable");
        c.why[why] = (c.why[why] || 0) + 1;
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  c.left_for_next_run = Math.max(0, c.todo - c.printed - c.flat - c.failed);
  const index = writeArchive(arch, OUT, { built, run: c });
  console.log("prints:", JSON.stringify(c), "archive rows", index.n, "pictures", index.pictures, "shards", index.shards.length);
}
if (import.meta.url === "file://" + path.resolve(process.argv[1] || "")) await main();
