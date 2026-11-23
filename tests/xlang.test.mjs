// Same story in other languages (tools/xlang_lib.mjs, tools/ledger_xlang.mjs, assets/osap-ledger.js), rules xmatch-v1.
// No outside network: the job is run against a stand-in embeddings server on 127.0.0.1 inside this test.
// Run from the repo root: node tests/xlang.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { PROFILE, MIN_POS, FLOOR, PER_LEDGER, BATCH, quantize, unit, dot, centroid, packCache, unpackCache, requestBody, readReply, usageToday, plan, cutoff, inWindow, propose, vkey, estTokens } from "../tools/xlang_lib.mjs";

let fails = 0, n = 0;
function ok(c, m) { n++; if (!c) { fails++; console.log("FAIL " + m); } else console.log("PASS " + m); }
const T = createRequire(import.meta.url)("../assets/osap-ledger.js");
const D = PROFILE.dims;

// ---------- vectors and the cache ----------
{
  const a = Array.from({ length: D }, (_, i) => Math.sin(i + 1)), q = quantize(a), u = unit(q);
  ok(q instanceof Uint8Array && q.length === D / 8, "quantize keeps one bit per dimension");
  ok(Math.abs(dot(u, u) - 1) < 1e-5, "unit() restores a unit vector");
  const b = unit(quantize(a.map((x) => x * 7))); ok(Math.abs(dot(u, b) - 1) < 1e-3, "scale does not change the vector");
  const m = new Map([["0123456789abcdef", q], ["fedcba9876543210", quantize(a.map((x) => -x))]]);
  const back = unpackCache(packCache(m));
  ok(back.size === 2 && back.get("0123456789abcdef").every((x, i) => x === q[i]), "cache file round trip");
  ok(unpackCache(Buffer.alloc(7)).size === 0, "a cut-off cache file is ignored, not misread");
  ok(vkey("a  b") === vkey("a b") && vkey("a") !== vkey("b") && /^[0-9a-f]{16}$/.test(vkey("x")), "cache keys: whitespace-insensitive, distinct, 16 hex");
}

// ---------- the API request and reply ----------
{
  const body = requestBody(["Корвет\u0000 Меркурий", "x".repeat(900)]);
  ok(body.model === "voyage-4" && body.output_dimension === 256 && body.input_type === "document" && body.truncation === true, "request: model, size, document type, truncation");
  ok(!/\u0000/.test(body.input[0]) && body.input[1].length === 400, "request: control characters removed, text capped");
  ok(!("api_key" in body) && !JSON.stringify(body).includes("Bearer"), "request body carries no key");
  const good = { data: [{ index: 1, embedding: Array(D).fill(0.1) }, { index: 0, embedding: Array(D).fill(-0.1) }], model: "voyage-4", usage: { total_tokens: 12 } };
  const r = readReply(good, 2);
  ok(r && r.tokens === 12 && r.vecs[0][0] === 0 && r.vecs[1][0] === 255, "reply: vectors put back in input order, tokens read");
  ok(readReply({ ...good, data: good.data.slice(0, 1) }, 2) === null, "reply with too few vectors: nothing used");
  ok(readReply({ ...good, data: [good.data[0], { index: 1, embedding: Array(D).fill(0) }] }, 2) === null, "reply with a repeated index: nothing used");
  ok(readReply({ ...good, data: [{ index: 0, embedding: Array(D - 1).fill(0.1) }, good.data[0]] }, 2) === null, "reply with the wrong size: nothing used");
  ok(readReply({ ...good, data: [{ index: 0, embedding: Array(D).fill(NaN) }, good.data[0]] }, 2) === null, "reply with NaN: nothing used");
  ok(readReply({ ...good, model: "<script>" }, 2).model === "voyage-4", "a model name that is not a plain name is not stored");
  ok(readReply("OK", 2) === null && readReply(null, 2) === null, "a text or empty reply gives nothing");
}

// ---------- caps ----------
{
  const now = Date.parse("2026-11-23T12:00Z");
  ok(usageToday({ day: "2026-11-22", tokens: 999 }, now).tokens === 0, "a new UTC day starts the count again");
  ok(usageToday({ day: "2026-11-23", tokens: 999 }, now).tokens === 999, "the same day keeps its count");
  const texts = Array.from({ length: 300 }, (_, i) => "headline number " + i);
  const p = plan(texts, 10 * estTokens(texts[0]));
  ok(p.batches.flat().length === 10, "plan stops at the tokens left");
  ok(plan(texts, 0).batches.length === 0, "nothing left: no request at all");
  ok(plan(texts, 1e9).batches.every((b) => b.length <= BATCH), "batches hold at most BATCH headlines");
}

// ---------- the rule ----------
{
  ok(cutoff(Array(MIN_POS - 1).fill(0.9), [0.1]).cut === null, "too few joined reports in other languages: no cut-off, nothing proposed");
  ok(cutoff(Array(MIN_POS).fill(FLOOR - 0.1), [0.1]).cut === null, "joined reports scoring under FLOOR (a model that does not tell stories apart): nothing proposed");
  ok(cutoff(Array(MIN_POS).fill(0.7), Array(1000).fill(0.2).concat(Array(10).fill(0.8))).cut === 0.8, "the cut-off never goes under the same-country 99.5th percentile");
  ok(cutoff(Array(MIN_POS).fill(0.7), [0.1]).cut === 0.7, "the cut-off is the joined reports' median");
  const L = { d0: "2026-11-20T10:00", d: "2026-11-21T10:00" };
  ok(inWindow(L, Date.parse("2026-11-20T00:00Z")) && !inWindow(L, Date.parse("2026-11-19T21:00Z")), "window starts 12 h before the first report");
  ok(inWindow(L, Date.parse("2026-11-24T10:00Z")) && !inWindow(L, Date.parse("2026-11-24T11:00Z")), "window ends 72 h after the newest report");
  const e = (i) => { const v = new Float32Array(D); v[i] = 1; return v; };
  const mix = (a, b, w) => centroid([a.map((x) => x * w), b.map((x) => x * (1 - w))]);
  const A = { id: "A", d0: L.d0, d: L.d, links: new Set(["https://in.example/1"]), anchors: [e(0)], c: e(0) };
  const B = { id: "B", d0: L.d0, d: L.d, links: new Set(), anchors: [e(1)], c: e(1) };
  const t = Date.parse("2026-11-21T00:00Z");
  const K = [
    { i: 0, ms: t, link: "https://x.example/close", v: mix(e(0), e(1), 0.9) },
    { i: 1, ms: t, link: "https://in.example/1", v: e(0) },
    { i: 2, ms: Date.parse("2026-11-25T00:00Z"), link: "https://x.example/late", v: e(0) },
    { i: 3, ms: t, link: "https://x.example/far", v: e(5) },
  ];
  const P = propose([A, B], K, 0.8);
  ok(P.get("A") && P.get("A").length === 1 && P.get("A")[0].i === 0, "a close headline is proposed to the ledger it is closest to, once");
  ok(!P.has("B"), "and not also to the other ledger");
  ok(!(P.get("A") || []).some((x) => x.i === 1), "a headline already in the ledger is never proposed");
  ok(!(P.get("A") || []).some((x) => x.i === 2), "a headline outside the window is never proposed");
  ok(!(P.get("A") || []).some((x) => x.i === 3), "an unrelated headline is never proposed");
  ok(propose([A], K, null).size === 0, "no cut-off: no proposal");
  const many = Array.from({ length: 12 }, (_, i) => ({ i, ms: t, link: "https://m.example/" + i, v: mix(e(0), e(1), 0.99 - i * 0.001) }));
  ok(propose([A], many, 0.5).get("A").length === PER_LEDGER, "at most PER_LEDGER proposals per ledger");
}

// ---------- the view's filter ----------
{
  const l = { id: "L1", rows: [["A", "other", "", "2026-11-20T10:00", "https://in.example/1", "x", 0, "f"]] };
  const f = { x: { L1: [["O", "other", "", "2026-11-20T11:00", "https://in.example/1", "dup", "", 0, 0.9, 0.9], ["O", "other", "", "2026-11-20T11:00", "javascript:alert(1)", "bad", "", 0, 0.9, 0.9],
    ["O", "other", "", "2026-11-20T11:00", "https://new.example/2", "ok", "orig", 1, 0.9, 0.9], ["short"]] } };
  const X = T.xRows(f, l);
  ok(X.length === 1 && X[0][4] === "https://new.example/2", "the page shows only well-formed proposals with a web link that are not already in the ledger");
  ok(T.xRows(null, l).length === 0 && T.xRows({ x: {} }, l).length === 0, "no file or no entry: nothing shown");
}

// ---------- the job, end to end, against a stand-in server ----------
const A0 = Array.from({ length: D }, (_, i) => Math.cos(i * 0.37));
function fakeVec(text) {
  const h = crypto.createHash("sha256").update(text).digest(), r = Array.from({ length: D }, (_, i) => ((h[i % 32] ^ (i * 31)) % 200) / 100 - 1);
  if (/Корвет Меркурий потоплен/.test(text)) return A0;                         // the missed report: right on the story
  if (/merkur|меркури/i.test(text)) return A0.map((x, i) => x + 0.3 * r[i]);    // the story's reports, a little apart
  return r;                                                                   // everything else: unrelated
}
function server(mode) {
  const seen = { calls: 0, auth: [], inputs: 0 };
  const s = http.createServer((q, res) => {
    let b = ""; q.on("data", (d) => (b += d)); q.on("end", () => {
      seen.calls++; seen.auth.push(q.headers.authorization || "");
      if (mode === "500") { res.writeHead(500); return res.end("busy"); }
      const o = JSON.parse(b); seen.inputs += o.input.length;
      const out = mode === "bad" ? { data: [] } : { data: o.input.map((t, i) => ({ index: i, embedding: fakeVec(t) })), model: "voyage-4", usage: { total_tokens: o.input.length * 10 } };
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out));
    });
  });
  return new Promise((ok) => s.listen(0, "127.0.0.1", () => ok({ s, seen, url: "http://127.0.0.1:" + s.address().port + "/v1/embeddings" })));
}
function run(env) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, ["tools/ledger_xlang.mjs"], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => ok({ code, out }));
  });
}
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xlang-")), IX = path.join(dir, "ix"), LG = path.join(dir, "ledger"), OUT = path.join(dir, "ledger-x");
  fs.mkdirSync(IX); fs.mkdirSync(LG);
  const END = "2026-11-23T12:00Z";
  // the index: the story's reports (Russian originals, translated), unrelated same-country headlines, the missed report, a decoy too early
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push(["ua", "2026-11-22T1" + i + ":00", "Merkur corvette report " + i, "Корвет Меркурий сообщение " + i, "Outlet" + i, "https://s.example/" + i, "", "m", "", ""]);
  for (let i = 0; i < 40; i++) rows.push(["ua", "2026-11-22T20:" + String(i).padStart(2, "0"), "Unrelated local news " + i, "", "Local" + i, "https://u.example/" + i, "", "", "", ""]);
  rows.push(["ru", "2026-11-23T08:00", "Корвет Меркурий потоплен", "", "Russian outlet", "https://miss.example/1", "", "", "", ""]);
  rows.push(["ru", "2026-11-21T00:00", "Меркурий: другое событие", "", "Russian outlet", "https://early.example/1", "", "", "", ""]);
  const byDay = {}; for (const r of rows) (byDay[r[1].slice(0, 10)] = byDay[r[1].slice(0, 10)] || []).push(r);
  for (const [d, l] of Object.entries(byDay)) fs.writeFileSync(path.join(IX, d + ".js"), "window.OSAP_NEWSIX_DAY=window.OSAP_NEWSIX_DAY||{};window.OSAP_NEWSIX_DAY[\"" + d + "\"]=" + JSON.stringify(l) + ";\n");
  const ledger = { id: "ldg-aaaaaaaaaaaa", t: "Merkur corvette", d0: "2026-11-22T10:00", d: "2026-11-22T15:00", n: 6, r: 6,
    rows: rows.slice(0, 6).map((r, i) => [r[4], "other", "ua", r[1], r[5], r[2], 1, i ? "r" : "f"]) };
  const lfile = path.join(LG, "ua.js"), ltext = "window.OSAP_LEDGER=" + JSON.stringify({ schema: "osap-ledger/1", cc: "ua", ledgers: [ledger] }) + ";\n";
  fs.writeFileSync(lfile, ltext);
  const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex"), lsha = sha(lfile);
  const base = { XLANG_IX: IX, XLANG_LEDGERS: LG, XLANG_OUT: OUT, XLANG_END: END, XLANG_CACHE: path.join(dir, "cache.bin"), XLANG_MIN_POS: "3" };
  const KEY = "test-key-never-logged-123";
  const readX = () => { const t = fs.readFileSync(path.join(OUT, "ua.js"), "utf8"); return JSON.parse(t.slice("window.OSAP_LEDGER_X=".length).replace(/;\s*$/, "")); };
  const usage = () => JSON.parse(fs.readFileSync(OUT + "-usage.json", "utf8"));

  // off: no key, no request, an earlier proposals file removed
  let sv = await server("ok");
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, "ua.js"), "stale");
  let r = await run({ ...base, XLANG_URL: sv.url });
  ok(r.code === 0 && sv.seen.calls === 0, "no VOYAGE_API_KEY: nothing is sent");
  ok(!fs.existsSync(path.join(OUT, "ua.js")) && usage().state === "off", "no key: earlier proposals removed, usage says off");

  // on: the missed Russian report is proposed, the decoy and the story's own reports are not, the ledger is untouched
  r = await run({ ...base, XLANG_URL: sv.url, VOYAGE_API_KEY: KEY });
  ok(r.code === 0 && sv.seen.calls > 0 && sv.seen.auth.every((a) => a === "Bearer " + KEY), "with the key: the provider is called, the key only in the Authorization header");
  ok(!r.out.includes(KEY) && !r.out.includes("Корвет") && !r.out.includes("Unrelated"), "logs carry neither the key nor any headline");
  const X = readX(), P = X.x[ledger.id] || [];
  ok(X.schema === "osap-ledger-x/1" && X.rules === "xmatch-v1" && X.model === "voyage-4" && X.cut && X.cut.cut >= FLOOR, "file carries schema, rules, the model the API reported and the cut-off");
  ok(P.length === 1 && P[0][4] === "https://miss.example/1", "the missed report in another language is proposed");
  ok(!P.some((p) => p[4] === "https://early.example/1"), "a same-word headline outside the story's window is not proposed");
  ok(!P.some((p) => /\/\/(s|u)\.example\//.test(p[4])), "neither the ledger's own reports nor unrelated headlines are proposed");
  ok(sha(lfile) === lsha, "the ledger file is never changed (proposals never join it)");
  const u1 = usage();
  ok(u1.state === "on" && u1.usage.tokens === sv.seen.inputs * 10 && u1.usage.calls === sv.seen.calls, "usage counts the API's own tokens and calls");
  ok(u1.usd_today >= 0 && u1.caps.daily_tokens > 0, "usage file shows the day's cost and the caps");

  // again: everything is cached, no request, the same proposals
  const before = sv.seen.calls, first = fs.readFileSync(path.join(OUT, "ua.js"), "utf8");
  r = await run({ ...base, XLANG_URL: sv.url, VOYAGE_API_KEY: KEY });
  ok(sv.seen.calls === before, "a second run embeds nothing it already has");
  ok(fs.readFileSync(path.join(OUT, "ua.js"), "utf8") === first, "the same input gives the same proposals (idempotent)");
  sv.s.close();

  // cap reached: no request, cached vectors still used
  fs.rmSync(path.join(dir, "cache.bin"));
  sv = await server("ok");
  r = await run({ ...base, XLANG_URL: sv.url, VOYAGE_API_KEY: KEY, XLANG_DAILY_TOKENS: "0" });
  ok(r.code === 0 && sv.seen.calls === 0 && usage().state === "capped", "daily cap reached: no request, usage says capped");
  ok(sha(lfile) === lsha, "cap reached: the ledger is untouched");
  sv.s.close();

  // provider failing: the run stops calling, exits cleanly, ledger untouched
  for (const mode of ["500", "bad"]) {
    sv = await server(mode);
    r = await run({ ...base, XLANG_URL: sv.url, VOYAGE_API_KEY: KEY });
    ok(r.code === 0 && sv.seen.calls === 1 && usage().state === "partial", "provider " + (mode === "500" ? "error (HTTP 500)" : "reply that does not fit") + ": one call, then it stops; usage says partial");
    ok(!fs.existsSync(path.join(OUT, "ua.js")) && sha(lfile) === lsha, "provider " + mode + ": no proposal without vectors, the ledger untouched");
    sv.s.close();
  }
  // provider unreachable
  r = await run({ ...base, XLANG_URL: "http://127.0.0.1:1/v1/embeddings", VOYAGE_API_KEY: KEY });
  ok(r.code === 0 && usage().state === "partial" && sha(lfile) === lsha, "provider unreachable: the run ends cleanly, the ledger untouched");
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
