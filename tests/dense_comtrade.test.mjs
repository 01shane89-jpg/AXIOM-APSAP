// UN Comtrade exports to Russia (tools/dense_comtrade.mjs)
import { comtradeItem } from "../tools/dense_comtrade.mjs";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const row = (cmd, v) => ({ cmdCode: String(cmd), primaryValue: v });
const it = comtradeItem("kz", "202608", [row(8517, 9202921.59), row(8471, 3665339.13), row(8525, 1724561.17), row(8542, 12172.76), row(1234, 9e9)], [row(8517, 4e6), row(8471, 2e6), row(8525, 1e6)]);
ok(it.title === "Kazakhstan reports $14.6 million of sanctions-sensitive exports to Russia in Aug 2026 (+109% on a year earlier)", "title: reporter, total, month, change (" + it.title + ")");
ok(/phones and network radio gear \$9\.2 million \(\$4\.0 million a year earlier\)/.test(it.detail) && !/9\.00 billion/.test(it.detail), "per-good detail with last year; other codes ignored");
ok(/not proof of sanctions evasion/.test(it.detail) && /Source: UN Comtrade\./.test(it.detail), "caveat and the required attribution");
ok(it.ccs.join() === "kz,ru" && it.sev === 2 && it.date === "2026-08-01", "placed on the reporter and Russia; a big rise ranks high");
ok(/Reporters=398/.test(it.url) && /Partners=643/.test(it.url), "links the same query on Comtrade");
ok(comtradeItem("kz", "202608", [], []) === null, "nothing reported, no item");
if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("all passed");
