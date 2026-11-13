// Every app file index.html loads (scripts, styles, icons under assets/) and every font file is in sw.js PRECACHE, so the
// service worker saves it before the first offline use. 2026-11-13: osap-news, osap-daily, osap-coverage, osap-mobility and
// osap-panels were missing, so a phone that saved a country for offline and lost signal straight away opened without them.
// Run from the repo root: node tests/sw_precache.test.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";
const sw = readFileSync("sw.js", "utf8"), idx = readFileSync("index.html", "utf8");
const pre = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]), set = new Set(pre);
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }
const refs = [...new Set([...idx.matchAll(/(?:src|href)="(assets\/[^"?#]+)"/g)].map((m) => m[1]))];
ok(refs.length > 50, "index.html app files found", refs.length);
ok(refs.filter((u) => !set.has(u)).length === 0, "every app file index.html loads is precached", refs.filter((u) => !set.has(u)));
const fonts = readdirSync("assets/fonts").filter((f) => f.endsWith(".woff2")).map((f) => "assets/fonts/" + f);
ok(fonts.filter((u) => !set.has(u)).length === 0, "every font file is precached", fonts.filter((u) => !set.has(u)));
ok(pre.length === set.size, "no address listed twice");
const gone = pre.filter((u) => u !== "./" && !existsSync(u.replace(/[?#].*$/, "")));
ok(gone.length === 0, "every precached address exists", gone.slice(0, 10));
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
