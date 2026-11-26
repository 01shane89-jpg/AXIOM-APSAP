// Shipping chokepoints against a long baseline and World Bank Pink Sheet prices (tools/choke_lib.mjs, rules choke-v1).
// Run from the repo root: node tests/choke.test.mjs
import zlib from "node:zlib";
import { RULES, chokeLong, readXlsxSheet, pinkSeries, priceSummary, PINK } from "../tools/choke_lib.mjs";

let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const DAY = 864e5, ymd = (t) => new Date(t).toISOString().slice(0, 10);
ok(RULES === "choke-v1", "rules choke-v1");

// a strait at ~86 ships a day through 2025 and into 2026 that collapses to ~3 a day from 1 Mar 2026; data to 15 Nov 2026
const meta = { cp6: { name: "Strait of Hormuz", lat: 26.6, lon: 56.3 }, cp5: { name: "Malacca Strait", lat: 2.5, lon: 101.4 }, cpx: { name: "New", lat: 0, lon: 0 } };
const rows = [];
for (let t = Date.parse("2025-01-01"); t <= Date.parse("2026-11-15"); t += DAY) {
  const war = t >= Date.parse("2026-03-01");
  rows.push({ portid: "cp6", date: ymd(t), n_total: war ? 3 : 86, n_tanker: war ? 1 : 48 });
  rows.push({ portid: "cp5", date: t, n_total: 230, n_tanker: 80 });
}
rows.push({ portid: "cp6", date: "2026-11-15", n_total: 3, n_tanker: 1 }); // duplicate day: counted once
for (let t = Date.parse("2026-10-01"); t <= Date.parse("2026-11-15"); t += DAY) rows.push({ portid: "cpx", date: ymd(t), n_total: 5, n_tanker: 0 });
rows.push({ portid: "nometa", date: "2026-11-15", n_total: 9 });
const out = chokeLong(rows, meta), h = out.find((c) => c.id === "cp6"), m = out.find((c) => c.id === "cp5"), x = out.find((c) => c.id === "cpx");
ok(out.length === 3 && !out.some((c) => c.id === "nometa"), "only chokepoints with metadata");
ok(h.last === "2026-11-15" && h.avg7 === 3 && h.base && h.base.year === 2025 && h.base.v === 86, "last 7 days and the 2025 average");
ok(h.chgBase === -97 && h.chgYago === -97, "a collapse months old shows against the base year (-97%) and a year before");
ok(h.chg28 === 0, "and is hidden by the 4-weeks-before comparison (0%), which is why this feed exists");
ok(h.tanker7 === 1 && h.tankerBase === 48, "tankers a day now and in the base year");
ok(m.chgBase === 0 && out[0].id === "cp6", "steady strait 0%; biggest fall sorts first");
ok(x.base === null && x.chgBase === null && out[out.length - 1].id === "cpx", "no base year without most of its days; sorted last");
ok(h.weeks.length === 78 && h.weeks[h.weeks.length - 1] === 3 && h.weeks.some((w) => w === 86), "78 weekly averages ending with the latest week");
const tiny = chokeLong([...Array(400)].map((_, i) => ({ portid: "cp6", date: ymd(Date.parse("2025-01-01") + i * DAY), n_total: i > 380 ? 2 : 0 })), meta)[0];
ok(tiny.chg28 === null && tiny.chgBase === null, "no percentage against under 1 ship a day");

// a minimal .xlsx: zip with workbook, rels, shared strings and one sheet (deflate and stored entries)
function zip(files) {
  const parts = [], dir = []; let off = 0;
  for (const [name, text, store] of files) {
    const raw = Buffer.from(text, "utf8"), data = store ? raw : zlib.deflateRawSync(raw), nb = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(store ? 0 : 8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(store ? 0 : 8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, data); dir.push(ch, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(dir), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
const strs = ["World Bank Commodity Price Data", "Crude oil, Brent", "Urea ", "Rice, Thai 5% ", "2026M01", "2026M02", "Note &amp; more"];
const si = strs.map((s) => "<si><t>" + s + "</t></si>").join("");
const n = (r, v) => '<c r="' + r + '" s="2"><v>' + v + "</v></c>", t = (r, i) => '<c r="' + r + '" s="1" t="s"><v>' + i + "</v></c>";
const sheet = '<worksheet><sheetData><row r="1">' + t("A1", 0) + '</row><row r="5">' + t("B5", 1) + t("C5", 2) + t("D5", 3) + '</row>' +
  '<row r="7">' + t("A7", 4) + n("B7", 66.8) + n("C7", 415.4) + '<c r="D7" t="str"><v>…</v></c></row>' +
  '<row r="8">' + t("A8", 5) + n("B8", 71.1) + n("C8", 472) + n("D8", 409) + '<c r="E8"/></row>' + '<row r="9">' + t("A9", 6) + "</row></sheetData></worksheet>";
const xl = zip([
  ["xl/workbook.xml", '<workbook><sheets><sheet name="AFOSHEET" sheetId="1" r:id="rId1"/><sheet name="Monthly Prices" sheetId="2" r:id="rId2"/></sheets></workbook>'],
  ["xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>', true],
  ["xl/sharedStrings.xml", "<sst>" + si + "</sst>"],
  ["xl/worksheets/sheet1.xml", "<worksheet><sheetData/></worksheet>"],
  ["xl/worksheets/sheet2.xml", sheet],
]);
const cells = readXlsxSheet(xl, "Monthly Prices");
ok(cells[4][1] === "Crude oil, Brent" && cells[6][1] === 66.8 && cells[8][0] === "Note & more", "xlsx: shared strings, numbers, entities, the right sheet");
let threw = false; try { readXlsxSheet(xl, "Nope"); } catch (e) { threw = /no sheet/.test(e.message); }
ok(threw, "xlsx: a missing sheet is an error");
threw = false; try { readXlsxSheet(Buffer.from("not a zip at all, just text padding padding"), "x"); } catch (e) { threw = true; }
ok(threw, "xlsx: not a zip is an error");
const ser = pinkSeries(cells);
ok(JSON.stringify(ser.brent) === JSON.stringify([["2026-01", 66.8], ["2026-02", 71.1]]) && ser.urea.length === 2, "Pink Sheet: titles matched after trimming (\"Urea \")");
ok(ser.rice.length === 1 && ser.rice[0][1] === 409, "Pink Sheet: a text cell (\"…\") is skipped, not read as a price");
ok(!ser.wheat && PINK.some((p) => p.id === "wheat"), "Pink Sheet: a missing column is left out");

const s = [];
for (let y = 2025; y <= 2026; y++) for (let mm = 1; mm <= 12; mm++) if (y < 2026 || mm <= 10) s.push([y + "-" + String(mm).padStart(2, "0"), y === 2026 && mm === 4 ? 857 : 400 + mm]);
const ps = priceSummary(s);
ok(ps.latest.m === "2026-10" && ps.prev.m === "2026-09" && ps.yago.m === "2025-10" && ps.hi12.v === 857 && ps.hi12.m === "2026-04", "price summary: latest, month before, a year before, 12-month high");
ok(ps.chgYago === 0 && ps.series.length === 22, "price summary: change on a year and up to 24 months kept");
ok(priceSummary([]) === null, "price summary: empty series");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
