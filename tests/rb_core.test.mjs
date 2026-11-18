// Report builder core (assets/osap-rb-core.js): the SITREP model, the product QC check and the release record.
// Positive: a complete product passes with no blocks; a release is numbered and records who, when and the QC result.
// Negative: missing BLUF, title, as-of, likelihood, confidence or citations block; a citation to nothing blocks; a legend that
// lists a symbol the map does not show (or misses one it does) blocks; unapproved AI text blocks and cannot be released without
// an override reason; warnings must be acknowledged; editing the caption does not change a snip's digest input, editing an item does.
// Run from the repo root: node tests/rb_core.test.mjs
import { createRequire } from "node:module";
const C = createRequire(import.meta.url)("../assets/osap-rb-core.js");
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }
const ids = (l) => l.map((x) => x.id);
const blocks = (l) => l.filter((x) => x.sev === "block");

const NOW = Date.UTC(2026, 10, 18, 1, 6);
ok(C.dtg(NOW) === "180106Z NOV 26", "DTG in Zulu: " + C.dtg(NOW));
ok(C.canon({ b: 1, a: [2, { d: 1, c: 2 }] }) === '{"a":[2,{"c":2,"d":1}],"b":1}', "canonical JSON sorts keys");
ok(C.LIKELIHOOD.length === 7 && C.lik("likely")[2] === "55-80%", "ICD 203 likelihood scale");

const store = C.emptyStore();
const snip = C.makeSnip({ id: "c1", P: [[26, 56], [26, 57], [27, 57], [27, 56]], base: "streets", baseAttr: "© OpenStreetMap contributors", cc: "ir", country: "Iran", period: "Last 7 days",
  legend: ["strike"], marks: [{ lat: 26.5, lon: 56.5, sym: "strike", no: "I1" }, { lat: 26.6, lon: 56.4, sym: "", no: "R1" }],
  items: [{ no: "I1", title: "Tanker hit near Hormuz", url: "https://example.org/a", src: "Wire A", t: NOW - 3600e3, fp: "a".repeat(64), lat: 26.5, lon: 56.5 },
    { no: "R1", title: "Navy says mines cleared", url: "https://example.org/b", src: "Ministry", t: NOW - 7200e3, fp: "b".repeat(64), claim: true, lat: 26.6, lon: 56.4 }] }, NOW - 600e3);
snip.digest = "c".repeat(64);
ok(snip.items[1].status.indexOf("claim") >= 0 && snip.items[1].stype === "official", "a government statement is labelled a claim");
ok(snip.dataAsOf === NOW - 3600e3, "snip data as-of is its newest item");
const d0 = C.snipDigestInput(snip);
ok(C.snipDigestInput(Object.assign({}, snip, { caption: "edited" })) === d0, "caption edits do not change the snip digest input");
ok(C.snipDigestInput(Object.assign({}, snip, { items: snip.items.map((x, i) => i ? x : Object.assign({}, x, { title: "changed" })) })) !== d0, "item edits change the snip digest input");
store.clips.push(snip);
const byId = { c1: snip };

const p = C.newProduct(store, "sitrep", { id: "p1", aoi: "Strait of Hormuz", author: "FOX6" }, NOW);
ok(/^OSAP-SR-20261118-01$/.test(p.no), "product number " + p.no);
store.products.push(p);
ok(C.newProduct(store, "sitrep", {}, NOW).no === "OSAP-SR-20261118-02", "next product number increments");

// empty product: the core rules block
let q = C.qc(p, byId, NOW);
ok(["H1", "A1", "A4"].every((x) => ids(blocks(q)).includes(x)), "empty product blocks on title, BLUF and key judgments: " + ids(blocks(q)).join(","));

// complete product
p.title = "Hormuz: tanker strike and mine-clearing claims";
p.blocks.bluf.text = "A tanker was struck near the Strait of Hormuz on 17 Nov [F1.I1]. The navy says mines were cleared [F1.R1].";
p.blocks.situation.text = "Wire A reports one tanker hit [F1.I1]; the ministry claims 12 mines cleared [F1.R1].";
p.blocks.gaps.text = "Who laid the mines is not reported.";
p.blocks.outlook.text = "Watch for insurance rate changes and further strikes [F1].";
p.figs.push({ clip: "c1", caption: "Reported strike and mine-clearing area" });
const k = C.newKj(NOW); k.text = "Further strikes on shipping in the strait are expected this week [F1.I1]."; k.lik = "likely"; k.conf = "moderate"; p.kjs.push(k);
q = C.qc(p, byId, NOW);
ok(blocks(q).length === 0, "complete product has no blocks: " + JSON.stringify(blocks(q)));

// negatives on judgments
k.lik = ""; q = C.qc(p, byId, NOW); ok(blocks(q).some((x) => x.id === "A5" && /likelihood/.test(x.msg)), "a judgment without a likelihood word blocks"); k.lik = "likely";
k.conf = ""; q = C.qc(p, byId, NOW); ok(blocks(q).some((x) => x.id === "A5" && /confidence/.test(x.msg)), "a judgment without confidence blocks"); k.conf = "moderate";
const t0 = k.text; k.text = "Further strikes are expected."; q = C.qc(p, byId, NOW); ok(blocks(q).some((x) => x.id === "A5" && /Cite/.test(x.msg)), "an uncited judgment blocks");
k.text = "Further strikes may follow [F1.I1]."; q = C.qc(p, byId, NOW); ok(q.some((x) => x.id === "A6" && /may/.test(x.msg)), "hedging word warns");
k.text = "Further strikes are very unlikely [F1.I1]."; q = C.qc(p, byId, NOW); ok(q.some((x) => x.id === "A6" && /very unlikely/.test(x.msg)), "text likelihood that contradicts the picked word warns");
k.text = "Further strikes are likely [F1.I1]."; q = C.qc(p, byId, NOW); ok(!q.some((x) => x.id === "A6"), "matching likelihood word passes");
k.text = t0;

// citations that resolve to nothing
p.blocks.bluf.text += " Also [S4] and [F1.I9]."; q = C.qc(p, byId, NOW);
ok(blocks(q).filter((x) => x.id === "S1").length === 2, "citations to a missing source and a missing item both block");
p.blocks.bluf.text = p.blocks.bluf.text.replace(" Also [S4] and [F1.I9].", "");

// uncited figures in the situation
p.blocks.situation.text += "\nOfficials say 40 people were killed."; q = C.qc(p, byId, NOW);
ok(q.some((x) => x.id === "S5"), "an uncited casualty figure warns");
p.blocks.situation.text = p.blocks.situation.text.split("\n")[0];

// map rules: the legend must match the symbols shown
snip.legend = ["strike", "clash"]; q = C.qc(p, byId, NOW); ok(blocks(q).some((x) => x.id === "F4" && /does not show/.test(x.msg)), "a legend listing an unshown symbol blocks");
snip.legend = []; q = C.qc(p, byId, NOW); ok(blocks(q).some((x) => x.id === "F4" && /missing from the legend/.test(x.msg)), "a symbol missing from the legend blocks");
snip.legend = ["strike"];
p.figs[0].caption = ""; q = C.qc(p, byId, NOW); ok(blocks(q).some((x) => x.id === "F1"), "a figure without a caption blocks"); p.figs[0].caption = "Reported strike area";
q = C.qc(p, byId, NOW + 30 * 3600e3); p.asOf = NOW + 30 * 3600e3; q = C.qc(p, byId, NOW + 30 * 3600e3); ok(q.some((x) => x.id === "F8"), "a snip older than 24 h before the as-of time warns"); p.asOf = NOW;
p.asOf = NOW + 3600e3; q = C.qc(p, byId, NOW); ok(blocks(q).some((x) => x.id === "H3"), "an as-of time in the future blocks"); p.asOf = NOW;
q = C.qc(p, { }, NOW); ok(blocks(q).some((x) => x.id === "F0"), "a figure whose snip was deleted blocks");

// AI authority
p.blocks.bluf.origin = "ai"; p.blocks.bluf.approved = false;
q = C.qc(p, byId, NOW); ok(blocks(q).some((x) => x.id === "A11"), "unapproved AI text blocks");
let r = C.release(p, byId, { ackWarnings: true }, NOW); ok(r.error === "ai-unapproved", "release refuses unapproved AI text");
r = C.release(p, byId, { ackWarnings: true, override: "Commander needs it now, accept risk" }, NOW); ok(r.error === "ai-unapproved", "unapproved AI text is never released, even with an override reason");
p.blocks.bluf.approved = true;
q = C.qc(p, byId, NOW); ok(!blocks(q).some((x) => x.id === "A11"), "approved AI text passes");
p.blocks.bluf.origin = "analyst";

// sources and warnings
p.srcs.push({ title: "Insurer note", url: "https://example.org/c", src: "Insurer", stype: "", pub: null, cap: NOW, fp: "" });
q = C.qc(p, byId, NOW); ok(["S4", "S3", "S6"].every((x) => ids(q).includes(x)), "a source without type, publish time or fingerprint, never cited, warns");
r = C.release(p, byId, {}, NOW); ok(r.error === "unacknowledged", "warnings must be acknowledged before release");
r = C.release(p, byId, { ackWarnings: true, actor: "FOX6", digest: "d".repeat(64) }, NOW);
ok(r.rec && r.rec.v === 1 && r.rec.by === "FOX6" && r.rec.blocks === 0 && r.rec.warns > 0 && r.rec.override === null && r.rec.digest.length === 64, "release record: version, actor, QC counts, no override");
p.releases.push(r.rec);
p.title = ""; ok(C.release(p, byId, { ackWarnings: true, override: "short" }, NOW).error === "blocked", "an override reason under 10 characters is refused");
r = C.release(p, byId, { ackWarnings: true, override: "Time-critical: commander asked for it now" }, NOW + 60e3);
ok(r.rec && r.rec.v === 2 && r.rec.blocks >= 1 && /commander/.test(r.rec.override) && r.rec.findings.some((x) => /H1/.test(x)), "an override release records the reason and the rules not met");
p.title = "Hormuz";
const i1 = C.releaseInput(p, byId); snip.caption = "x"; ok(C.releaseInput(p, byId) === i1, "release digest input ignores the snip's own caption when the figure has one");
p.figs[0].caption = "changed"; ok(C.releaseInput(p, byId) !== i1, "release digest input changes when the figure caption changes");

// store hygiene
const bad = C.normStore({ schema: "osap-rb/1", clips: [{ id: "x", kind: "evidence" }, null, { id: "c", kind: "snip" }], products: [{ id: "p", tpl: "nope" }] });
ok(bad.clips.length === 1 && bad.products.length === 0, "the store drops unknown clip kinds and templates");
ok(C.normStore({ schema: "other" }).clips.length === 0, "a foreign store is not read");
ok(C.safeUrl("javascript:alert(1)") === "" && C.safeUrl("https://a.b/c") === "https://a.b/c", "only http(s) links survive");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
