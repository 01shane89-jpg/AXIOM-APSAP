// Capture records: written once, never edited, a changed item becomes a new revision, times kept apart, store bounded.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { plan, write, readIndex, captureId } from "../tools/capture_lib.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "captures-"));
const ctx = (collected) => ({ collected, retainDays: 365, sourceOf: (i) => i.feed });
const a = { link: "https://example.org/a", title: "ยิงตำรวจ", summary: "", date: "2026-10-03T08:52", first_seen: "2026-10-03 09:30Z", lang: "th",
  outlet: "Isranews", feed: "isranews-south", via: "RSS", title_en: "Police shot", mt: "MADLAD-400" };
const page = { link: "https://example.org/p", title: "Page link", summary: "", date: "2026-10-03T09:30", date_seen: true, undated: true, first_seen: "2026-10-03 09:30Z", lang: "en", feed: "prd-yala", via: "RSS" };
const bing = { link: "https://example.org/b", title: "Bomb in Yala", summary: "", date: "2026-10-03T16:41", first_seen: "2026-10-03 09:30Z", lang: "en", feed: "bing-x", via: "search", nc: true };

// first run: one capture each, plus a translation for the Thai item
let run = plan([a, page, bing], readIndex(dir), ctx("2026-10-03T09:30"));
write(dir, run.records, run.index, ctx("2026-10-03T09:30"));
const caps = run.records.filter((r) => r.type === "capture");
assert.equal(caps.length, 3);
assert.equal(run.records.filter((r) => r.type === "translation").length, 1);
const ca = caps.find((r) => r.url === a.link);
assert.equal(ca.capture_id, captureId(a.link));
assert.equal(ca.rev, 1);
assert.equal(ca.published, "2026-10-03T08:52");
assert.equal(ca.observed, "2026-10-03T09:30");
assert.equal(ca.collected, "2026-10-03T09:30");
assert.equal(ca.source_id, "isranews-south");
assert.match(ca.sha, /^[0-9a-f]{64}$/);
// an undated page link is never given the collection time as its publication time
const cp = caps.find((r) => r.url === page.link);
assert.equal(cp.published, null);
assert.equal(cp.published_precision, "unknown");
// a search result is a lead, and a source time later than the run is flagged rather than trusted
const cb = caps.find((r) => r.url === bing.link);
assert.equal(cb.discovery, true);
assert.equal(cb.licence, "nc");
assert.equal(cb.time_check, "published_after_collected");
const tr = run.records.find((r) => r.type === "translation");
assert.equal(tr.parent, ca.capture_id);
assert.equal(tr.engine, "MADLAD-400");

// same items again: nothing new is written (idempotent replay)
run = plan([a, page, bing], readIndex(dir), ctx("2026-10-03T09:45"));
assert.equal(run.records.length, 0);
write(dir, run.records, run.index, ctx("2026-10-03T09:45"));

// a changed headline (a casualty figure updated) is a new revision that names the previous one
const a2 = { ...a, title: "ยิงตำรวจ เสียชีวิต 2", title_en: "Police shot, 2 dead" };
run = plan([a2], readIndex(dir), ctx("2026-10-03T10:00"));
const rev2 = run.records.find((r) => r.type === "capture");
assert.equal(rev2.rev, 2);
assert.equal(rev2.previous_sha, ca.sha);
assert.equal(run.records.find((r) => r.type === "translation").parent_rev, 2);
write(dir, run.records, run.index, ctx("2026-10-03T10:00"));

// files are never rewritten: both revisions are on file
const day = path.join(dir, "2026-10-03");
assert.deepEqual(fs.readdirSync(day).sort(), ["0930.ndjson", "1000.ndjson"], "one file per run that wrote something");
const lines = fs.readdirSync(day).sort().flatMap((f) => fs.readFileSync(path.join(day, f), "utf8").trim().split("\n").map((l) => JSON.parse(l)));
assert.deepEqual(lines.filter((r) => r.url === a.link && r.type === "capture").map((r) => r.rev), [1, 2]);

// retention: day files older than the limit are removed, newer ones stay, and nothing is re-recorded
fs.mkdirSync(path.join(dir, "2025-01-01")); fs.writeFileSync(path.join(dir, "2025-01-01", "0000.ndjson"), "{}\n");
const r = write(dir, [], readIndex(dir), ctx("2026-10-04T00:00"));
assert.equal(r.dropped, 1);
assert.ok(fs.existsSync(day));
assert.equal(plan([a2, page, bing], readIndex(dir), ctx("2026-10-04T00:15")).records.length, 0);

// bad links are skipped
assert.equal(plan([{ link: "javascript:alert(1)", title: "x" }, { title: "no link" }], {}, ctx("2026-10-04T00:15")).records.length, 0);
fs.rmSync(dir, { recursive: true });
console.log("captures: ok");
