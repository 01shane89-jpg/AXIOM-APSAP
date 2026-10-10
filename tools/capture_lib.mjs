// Capture records (Conflict Coverage plan, Phase 1, step 2; the plan's "evidence item"). Each item a connector collects is written
// once as an append-only capture record. A capture is what a source published as OSAP read it: it is not admitted evidence, a
// verified fact or a finding (in AXIOM terms a Capture, which only an analyst decision can admit as Evidence).
// It is kept apart from the headline objects the page reads, so what a source published, when OSAP first saw it and
// any later change to it stay on file. Machine translations are separate derived records that point at their parent.
//
// Files: <dir>/<YYYY-MM-DD>/<HHMM>.ndjson, one file per collection run (UTC), one JSON record per line. A file is written once and
//        never changed, so the repository stores each record once instead of a growing day file at every commit.
//        <dir>/index.json: { "<capture_id>": { rev, sha, tr } } so a later run knows what it already wrote.
// A record is never edited. A second run that sees the same item writes nothing; a source that changes an item's text writes a
// new revision (rev + 1) carrying the earlier revision's fingerprint, so a changed casualty figure or headline is never silent.
//
// Times: published = the source's own time as OSAP read it (UTC, minute precision) when the source gave
// one; observed = OSAP's first sighting; collected = this run. They are never substituted for one another: an undated page link
// has published null. time_check "published_after_collected" marks a source time later than the run that read it (seen on
// Bing results whose Thai local times appear to be labelled GMT), so it can be measured rather than trusted.
//
// The fingerprint (sha) is SHA-256 over the stored fields only: it shows the stored text changed, not that it is true.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const SCHEMA = "osap-capture/1";
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const captureId = (url) => "cap-" + sha(String(url)).slice(0, 20);
// the stored fields, in a fixed order, that the fingerprint covers
const body = (i) => JSON.stringify([i.title || "", i.summary || "", i.published || "", i.lang || ""]);

// item: a connector's item ({ link, title, summary, date, lang, outlet, feed, via, undated, date_seen, ... })
// ctx: { collected: "YYYY-MM-DDTHH:MM" UTC, sourceOf: (item) => source_id, retainDays }
export function toCapture(item, ctx) {
  const published = item.date && !item.date_seen && !item.undated ? item.date.slice(0, 16) : null;
  const rec = {
    schema: SCHEMA, type: "capture", capture_id: captureId(item.link), source_id: ctx.sourceOf(item),
    url: item.link, outlet: item.outlet || null, via: item.via || null,
    published, published_precision: published ? "minute" : "unknown",
    observed: (item.first_seen || "").replace(" ", "T").replace(/Z$/, "").slice(0, 16) || ctx.collected,
    collected: ctx.collected, lang: item.lang || null,
    title: item.title || "", summary: item.summary || "",
    licence: item.nc ? "nc" : "pending",
    retain_until: ctx.retainDays ? new Date(Date.parse(ctx.collected + ":00Z") + ctx.retainDays * 864e5).toISOString().slice(0, 10) : null,
  };
  if (published && published > ctx.collected) rec.time_check = "published_after_collected";
  if (item.via === "search") rec.discovery = true;   // a search listing points at the outlet's article; it is a lead, not the outlet's own feed
  rec.sha = sha(body(rec));
  return rec;
}

export function toTranslation(ev, item) {
  if (!item.title_en || !item.mt || /^en\b/i.test(item.lang || "")) return null;
  const rec = { schema: SCHEMA, type: "translation", parent: ev.capture_id, parent_rev: ev.rev, engine: item.mt, made: ev.collected,
    from_lang: item.lang || null, title_en: item.title_en, summary_en: item.summary_en || null };
  rec.sha = sha(JSON.stringify([rec.parent, rec.parent_rev, rec.engine, rec.title_en, rec.summary_en || ""]));
  return rec;
}

export function readIndex(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")); } catch (e) { return {}; }
}

// Decide what to append. Pure: returns { records, index } and changes nothing on disk.
export function plan(items, index, ctx) {
  const out = [], next = { ...index };
  for (const item of items) {
    if (!item || !item.link || !/^https?:\/\//.test(item.link)) continue;
    const ev = toCapture(item, ctx), was = next[ev.capture_id];
    if (was && was.sha === ev.sha) {
      // same text: only a translation not written before is added
      const tr = toTranslation({ ...ev, rev: was.rev }, item);
      if (tr && tr.sha !== was.tr) { out.push(tr); next[ev.capture_id] = { ...was, tr: tr.sha }; }
      continue;
    }
    ev.rev = was ? was.rev + 1 : 1;
    if (was) ev.previous_sha = was.sha;
    out.push(ev);
    const tr = toTranslation(ev, item);
    if (tr) out.push(tr);
    next[ev.capture_id] = { rev: ev.rev, sha: ev.sha, ...(tr ? { tr: tr.sha } : {}) };
  }
  return { records: out, index: next };
}

// Append the planned records to today's file and save the index. Day folders older than retainDays are removed (the stated
// retention), so the store stays bounded. Their index entries stay, so an item a source still lists is not recorded again.
export function write(dir, records, index, ctx) {
  fs.mkdirSync(dir, { recursive: true });
  const day = ctx.collected.slice(0, 10), hhmm = ctx.collected.slice(11, 16).replace(":", "");
  if (records.length) {
    fs.mkdirSync(path.join(dir, day), { recursive: true });
    fs.appendFileSync(path.join(dir, day, hhmm + ".ndjson"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  let dropped = 0;
  if (ctx.retainDays) {
    const oldest = new Date(Date.parse(day) - ctx.retainDays * 864e5).toISOString().slice(0, 10);
    for (const f of fs.readdirSync(dir)) if (/^\d{4}-\d{2}-\d{2}$/.test(f) && f < oldest) { fs.rmSync(path.join(dir, f), { recursive: true }); dropped++; }
  }
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
  return { written: records.length, dropped };
}
