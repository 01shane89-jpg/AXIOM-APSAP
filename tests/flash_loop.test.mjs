// Flash loop pieces (tools/quake_rows.mjs, tools/push_lib.mjs PUSH_LIST). Run from the repo root: node tests/flash_loop.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { quakeRow, mergeQuakes } from "../tools/quake_rows.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const now = Date.UTC(2026, 10, 8, 12, 0);
const f = (id, mag, t, extra = {}) => ({ id, properties: { mag, time: t, place: "x", status: "automatic", type: "earthquake", ...extra }, geometry: { coordinates: [140, 35, 10] } });
const r = quakeRow(f("a1", 4.2, now - 6e4));
ok(r && r.id === "a1" && r.lat === 35 && r.lon === 140 && r.depth === 10 && r.alert === null, "a USGS feature becomes the row quakes.js keeps");
ok(quakeRow(f("b1", null, now)) === null, "no magnitude: no row");
ok(quakeRow(f("c1", 3, now, { type: "quarry blast" })) === null, "a quarry blast is not a quake row");

const week = [quakeRow(f("old", 5, now - 8 * 864e5)), quakeRow(f("q1", 4.0, now - 36e5)), quakeRow(f("q2", 3.1, now - 72e5))];
const hour = [quakeRow(f("q3", 4.6, now - 3e4)), quakeRow(f("q1", 4.3, now - 36e5, { status: "reviewed" })), quakeRow(f("q2", 3.1, now - 72e5))];
const m = mergeQuakes(week, hour, now);
ok(m.added.join() === "q3", "a quake not in the 7-day file is added");
ok(m.changed.join() === "q1", "a quake USGS revised replaces its row; an unchanged one is not counted");
ok(m.rows.map((q) => q.id).join() === "q3,q1,q2", "newest first, and a quake older than 7 days drops off");
ok(m.rows.find((q) => q.id === "q1").mag === 4.3, "the revised magnitude is kept");
const again = mergeQuakes(m.rows, hour, now);
ok(!again.added.length && !again.changed.length, "the same hour laid over twice changes nothing (no push check for nothing)");

// PUSH_LIST: a local test list, checked like the server's
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flash-")), file = path.join(dir, "w.json");
fs.writeFileSync(file, JSON.stringify({ watches: [{ id: "wflashtest-jp", cc: "jp", topic: "osap-0123456789abcdef01", minSev: 1 }, { id: "bad id", cc: "jp", topic: "x" }] }));
process.env.PUSH_LIST = file;
const { fetchList } = await import("../tools/push_lib.mjs");
const l = await fetchList();
ok(l.watches.length === 1 && l.watches[0].id === "wflashtest-jp", "PUSH_LIST is read and each test watch checked like a real one");
delete process.env.PUSH_LIST;

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
