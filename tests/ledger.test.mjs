// Claim ledger (tools/ledger_lib.mjs, tools/claim_ledger.mjs, assets/osap-ledger.js), rules ledger-v1. No network.
// Run from the repo root: node tests/ledger.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { DISPUTE, qualifies, matchSeed, newSeed, joins, chain, build, MAX_ROWS } from "../tools/ledger_lib.mjs";
import { stems } from "../tools/threads_lib.mjs";

let fails = 0, n = 0;
function ok(c, m) { n++; if (!c) { fails++; console.log("FAIL " + m); } else console.log("PASS " + m); }
const T = createRequire(import.meta.url)("../assets/osap-ledger.js");

// the word list is Share this trail's, never a second copy that drifts
{
  const src = fs.readFileSync("assets/osap-trail.js", "utf8"), m = /var DISPUTE = (\/.*\/i);/.exec(src);
  ok(m && m[1] === String(DISPUTE), "DISPUTE is the same word match as Share this trail (assets/osap-trail.js)");
}

const row = (outlet, date, title, link, kind = "other", occ = "ua", mt = 0) => [outlet, kind, "dom", occ, date, link, title, mt, 0];
const thread = (over = {}) => ({ id: "aaaaaaaaaaaa", t: "Ukraine says drones sank corvette Merkur", u: "https://a.example/1", n: 4, r: 4, w: ["merkur", "corvette", "sank", "drone"], d0: "2026-11-20T10:00", d: "2026-11-21T10:00",
  rows: [row("A", "2026-11-20T10:00", "Ukraine says drones sank corvette Merkur", "https://a.example/1"), row("B", "2026-11-20T11:00", "Russia denies corvette Merkur was sunk", "https://b.example/1", "state"),
    row("C", "2026-11-20T12:00", "Corvette Merkur sank, Kyiv says", "https://c.example/1"), row("D", "2026-11-21T10:00", "Merkur corvette sinking: what we know", "https://d.example/1")], ...over });

// which stories get a ledger
ok(qualifies(thread(), null), "a story a headline denies, carried by 4 outlets, gets a ledger");
ok(!qualifies(thread({ n: 2 }), null), "two outlets are not enough");
ok(!qualifies(thread({ rows: thread().rows.filter((r) => !DISPUTE.test(r[6])) }), null), "no denial and no differing figure: no ledger");
ok(qualifies(thread({ rows: thread().rows.filter((r) => !DISPUTE.test(r[6])), fig: [["killed", "killed or dead", [[3, 0], [5, 1]]]] }), null), "figures that differ are enough without a denial");
ok(!qualifies(thread(), () => "drop"), "sport and show business (relevance drop) get none");
ok(!DISPUTE.test("Denmark expels diplomat") && DISPUTE.test("Kremlin denies report"), "Denmark is not a denial, denies is");

// which seed a thread continues: same country, three shared words, seen recently; words never drift
{
  const now = Date.parse("2026-11-23T00:00Z");
  const s = newSeed(thread(), "ua", "2026-11-20 12:00Z");
  ok(/^ldg-[0-9a-f]{12}$/.test(s.id) && s.w.join() === "merkur,corvette,sank,drone", "a new seed keeps the thread's words and a stable id");
  ok(matchSeed([s], "ua", ["merkur", "corvette", "drone", "navy"], now) === s, "three shared words continue the seed");
  ok(matchSeed([s], "ru", ["merkur", "corvette", "drone"], now) === null, "another country's thread does not (case files stay per country)");
  ok(matchSeed([s], "ua", ["merkur", "navy", "black"], now) === null, "one shared word does not");
  ok(matchSeed([{ ...s, last: "2026-11-10T00:00" }], "ua", s.w, now) === null, "a seed not seen for days is not continued by a new thread");
}

// which headlines join: the thread rule over the seed's sharp words
{
  const s = { w: ["merkur", "corvette", "sank", "drone"] }, sharp = new Set(["merkur", "corvette"]);
  ok(joins(stems("Corvette Merkur raised from the seabed"), s, sharp), "two sharp words join");
  ok(joins(stems("Navy drone sank the Merkur"), s, sharp), "one sharp word and two more join");
  ok(!joins(stems("Drone sank a fishing boat"), s, sharp), "common words alone (drone, sank) never join");
}

// the chain: reports past a silence longer than 72 hours are another event
{
  const seed = { d0: "2026-11-20T10:00", last: "2026-11-21T10:00" };
  const at = (d) => ({ ms: Date.parse(d + "Z"), link: d });
  const out = chain([at("2026-11-01T10:00"), at("2026-11-17T12:00"), at("2026-11-19T09:00"), at("2026-11-20T10:00"), at("2026-11-22T20:00"), at("2026-11-25T18:00"), at("2026-12-04T00:00")], seed);
  ok(out.map((r) => r.link).join() === "2026-11-17T12:00,2026-11-19T09:00,2026-11-20T10:00,2026-11-22T20:00,2026-11-25T18:00", "the chain reaches back and forward within 72-hour gaps and stops at a longer silence " + JSON.stringify(out.map((r) => r.link)));
  ok(chain([at("2026-11-01T10:00")], seed).length === 0, "nothing inside the seed's own window: no chain");
}

// the ledger
const rep = (outlet, d, title, link, kind = "other") => ({ outlet, kind, occ: "ua", date: d, ms: Date.parse(d + "Z"), link, title, mt: false });
const seed = { id: "ldg-000000000001", t: "Ukraine says drones sank corvette Merkur", u: "https://a.example/1", w: ["merkur", "corvette", "sank", "drone", "kill", "crew"], born: "2026-11-20 12:00Z" };
const reps = [
  rep("A", "2026-11-20T10:00", "Ukraine says drones sank corvette Merkur", "https://a.example/1"),
  rep("B", "2026-11-20T11:00", "Russia denies corvette Merkur was sunk", "https://b.example/1", "state"),
  rep("A", "2026-11-20T12:00", "Merkur corvette sank, 3 killed", "https://a.example/2"),
  rep("C", "2026-11-22T09:00", "Merkur corvette sinking: 5 killed, navy ministry says", "https://c.example/1", "public"),
  rep("D", "2026-11-25T09:00", "Satellite images show corvette Merkur listing", "https://d.example/1"),
  rep("D", "2026-11-25T09:00", "duplicate link", "https://d.example/1"),
  rep("D", "2026-11-25T10:00", "Satellite images show corvette  Merkur listing", "https://d.example/amp/1"),
];
const strike = { "https://a.example/1": ["russia-ukraine", "a".repeat(64), 44.6, 33.5, "2026-11-20T10:00", "approx", "drone"] };
const L = build(seed, reps, { thread: "aaaaaaaaaaaa", sensorOf: (u) => strike[u] || null });
{
  ok(L.r === 5 && L.n === 4, "duplicate links, and one outlet's same headline at two addresses, count once: 5 reports, 4 outlets (" + L.r + ", " + L.n + ")");
  ok(L.rows[0][0] === "A" && /f/.test(L.rows[0][7]), "the earliest report is the first report OSAP holds");
  ok(L.rows.filter((r) => /[fr]/.test(r[7])).map((r) => r[0]).join() === "A,B,C,D", "each outlet's first headline is marked once, in time order");
  ok(/d/.test(L.rows[1][7]) && !/o/.test(L.rows[1][7]), "a denial is marked deny or dispute (and not also as the official line)");
  ok(/o/.test(L.rows[3][7]) && /o/.test(L.rows[0][7]), "officials' lines (says, ministry) are marked as the official line");
  ok(L.nd === 1 && L.no === 2, "counts of denials and official lines (" + L.nd + ", " + L.no + ")");
  const f = L.figs.find((x) => x[0] === "killed");
  ok(f && f[2].map((x) => x[0]).join() === "3,5", "the toll's path in time order: 3 then 5 " + JSON.stringify(L.figs));
  ok(L.days.map((d) => d.join("/")).join(" ") === "2026-11-20/3/2/1/1 2026-11-22/1/1/0/1 2026-11-25/1/1/0/0", "day by day: reports, new outlets, denials, officials " + JSON.stringify(L.days));
  ok(L.sensor.length === 1 && L.sensor[0][0] === "russia-ukraine" && L.sensor[0][7] === 0 && /s/.test(L.rows[0][7]), "a strike report on a conflict tab is paired for the sensor picture");
  ok(L.dn === 3 && L.thread === "aaaaaaaaaaaa" && /^[0-9a-f]{64}$/.test(L.fp), "days followed, the live thread, and the record fingerprint");
  ok(build(seed, reps.slice().reverse(), { thread: "aaaaaaaaaaaa", sensorOf: (u) => strike[u] || null }).fp === L.fp, "the same reports in another order give the same ledger fingerprint");
  // the doctrine: claims, never a verdict
  const J = JSON.stringify(L);
  ok(!/"(verdict|assessment|verified|confirmed|true|false|rating|approved)"\s*:/.test(J), "a ledger carries no verdict, assessment or approval field");
  ok(L.k.state === 1 && L.k.public === 1 && L.k.other === 2, "owner split per outlet (state media lines stay claims on the page)");
}
// caps: the first report, every denial and figure row survive the cap
{
  const many = [];
  for (let i = 0; i < 400; i++) many.push(rep("O" + i, new Date(Date.parse("2026-11-20T00:00Z") + i * 6e4 * 10).toISOString().slice(0, 16), i === 399 ? "Kremlin denies corvette Merkur sank" : "Corvette Merkur report " + i, "https://m.example/" + i));
  const B = build(seed, many, {});
  ok(B.rows.length === MAX_ROWS && B.r === 400 && /f/.test(B.rows[0][7]) && B.rows.some((r) => /d/.test(r[7])), "past " + MAX_ROWS + " rows the first report and the late denial are kept, and the counts say the whole");
}

// page helpers
{
  const p = T.figPath(["killed", "killed or dead", [[3, 0], [3, 1], [5, 2]]]);
  ok(p.lo === 3 && p.hi === 5 && p.steps.map((x) => x.changed).join() === "false,false,true", "figPath marks where a figure changed");
  const g = T.sensorGroups({ sensor: [["iran-war", "b".repeat(64), 26.2, 50.5, "2026-11-21T21:00", "approx", "missile", 3], ["iran-war", "c".repeat(64), 26.21, 50.51, "2026-11-21T00:00", "approx", "attack", 1], ["iran-war", "not a fp", 0, 0, "", "", "", 0]] });
  ok(g.length === 1 && g[0].fps.length === 2 && g[0].pins.length === 1 && g[0].pins[0].t === "2026-11-21T00:00", "sensorGroups: one place, the earliest report there, bad fingerprints dropped");
  ok(T.rowsWith({ rows: [["a", "", "", "", "", "", 0, "fs"], ["b", "", "", "", "", "", 0, "rd"]] }, "d").join() === "1", "rowsWith finds rows by role");
}

// the build step end to end on a small index: a ledger, then (four days on, the story gone from the threads) the same ledger kept
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  fs.mkdirSync(dir + "/ix"); fs.mkdirSync(dir + "/th");
  const day = (d, rows) => fs.writeFileSync(`${dir}/ix/${d}.js`, `window.OSAP_NEWSIX_DAY=window.OSAP_NEWSIX_DAY||{};window.OSAP_NEWSIX_DAY["${d}"]=` + JSON.stringify(rows) + ";\n");
  // [cc, date, title, orig, outlet, link, summary, flags, topics, views]
  const ix = (d, title, outlet, link, flags = "") => ["ua", d, title, "", outlet, link, "", flags, "", ""];
  // filler, so the story's own words are rare in the index (sharp)
  const fill = []; for (let i = 0; i < 60; i++) fill.push(ix("2026-11-19T0" + (i % 10) + ":00", "Drone sank a barge, markets update number " + i, "F" + (i % 7), "https://f.example/" + i));
  day("2026-11-19", fill.concat([ix("2026-11-19T22:00", "Navy drone strike reported near Sevastopol, corvette Merkur hit", "E", "https://e.example/0")]));
  day("2026-11-20", [ix("2026-11-20T10:00", "Ukraine says drones sank corvette Merkur", "A", "https://a.example/1"), ix("2026-11-20T11:00", "Russia denies corvette Merkur was sunk", "B", "https://b.example/1", "g"),
    ix("2026-11-20T12:00", "Corvette Merkur sank, Kyiv says", "C", "https://c.example/1")]);
  day("2026-11-23", [ix("2026-11-23T06:00", "Corvette Merkur: navy ministry now says 5 killed", "G", "https://g.example/1")]);
  day("2026-11-25", [ix("2026-11-25T09:00", "Corvette Merkur denial repeated by Moscow", "H", "https://h.example/1"), ix("2026-11-25T09:30", "Drone sank fishing boat near Odesa", "I", "https://i.example/1")]);
  const th = { schema: "osap-threads/1", cc: "ua", hours: 72, threads: [{ ...thread(), rows: thread().rows.slice(0, 3) }] };
  fs.writeFileSync(dir + "/th/ua.js", "window.OSAP_THREADS=" + JSON.stringify(th) + ";\n");
  const run = (end) => execFileSync(process.execPath, ["tools/claim_ledger.mjs"], { env: { ...process.env, LEDGER_IX: dir + "/ix", LEDGER_THREADS: dir + "/th", LEDGER_OUT: dir + "/out", LEDGER_END: end, OSAP_COMMERCIAL: "" }, encoding: "utf8" });
  const read = () => { const w = {}; new Function("window", fs.readFileSync(dir + "/out/ua.js", "utf8"))(w); return w.OSAP_LEDGER; };
  const log1 = run("2026-11-21T12:00:00Z"), A = read();
  ok(/ledger: 1 ledgers/.test(log1) && !/Merkur|corvette/i.test(log1), "first run: one ledger, and the log carries counts only, no headline text");
  const a = A.ledgers[0];
  ok(a && a.thread === "aaaaaaaaaaaa" && a.rows[0][0] === "E" && a.r === 4, "it reaches back past the thread to the earlier report OSAP holds (" + (a && a.rows.map((r) => r[0]).join()) + ")");
  ok(a && a.rows.find((r) => r[0] === "B")[1] === "state", "an index row flagged state media is state media");
  const st1 = JSON.parse(fs.readFileSync(dir + "/out-state.json", "utf8"));
  ok(st1.seeds.length === 1 && st1.seeds[0].w.join() === "merkur,corvette,sank,drone", "the seed is kept in the job's state file with its words");
  run("2026-11-21T12:00:00Z");
  ok(JSON.stringify(read().ledgers) === JSON.stringify(A.ledgers) && JSON.parse(fs.readFileSync(dir + "/out-state.json", "utf8")).seeds.length === 1, "running twice gives the same ledger and one seed (no duplicate)");
  // four days later: no thread in the window any more
  fs.writeFileSync(dir + "/th/ua.js", "window.OSAP_THREADS=" + JSON.stringify({ ...th, threads: [] }) + ";\n");
  run("2026-11-25T12:00:00Z");
  const b = read().ledgers[0];
  ok(b && b.id === a.id && b.thread === "" && b.rows.some((r) => r[0] === "G") && b.rows.some((r) => r[0] === "H" && /d/.test(r[7])), "past the 72 hours it keeps following: the later toll and the later denial join (" + (b && b.rows.map((r) => r[0] + ":" + r[7]).join()) + ")");
  ok(b && !b.rows.some((r) => r[0] === "I"), "a headline sharing only common words (drone, sank) does not join");
  // gone from the index past the keep window: dropped
  run("2026-12-30T12:00:00Z");
  ok(!fs.existsSync(dir + "/out/ua.js") && JSON.parse(fs.readFileSync(dir + "/out-state.json", "utf8")).seeds.length === 0, "a month after its last report the ledger and its seed are dropped");
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`${n - fails} of ${n} passed`);
process.exit(fails ? 1 : 0);
