// Source grading (assets/osap-grade.js): the Admiralty / NATO scale, cleaning stored and imported grades, the per-source
// default key, and the picker and badge markup (escaped, and a default only pre-fills). Run: node tests/grade.test.mjs
import { createRequire } from "node:module";
const G = createRequire(import.meta.url)("../assets/osap-grade.js");
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }

ok(G.REL.map((x) => x[0]).join("") === "ABCDEF" && G.CRED.map((x) => x[0]).join("") === "123456", "scale is A-F and 1-6");
ok(G.relName("A") === "Completely reliable" && G.relName("E") === "Unreliable" && G.relName("F") === "Reliability cannot be judged", "reliability names");
ok(G.credName("1") === "Confirmed by other sources" && G.credName(5) === "Improbable" && G.credName("6") === "Truth cannot be judged", "credibility names");

ok(G.code({ r: "B", c: "2" }) === "B2", "B2");
ok(G.code("b2") === "B2" && G.code(" C 3 ") === "C3", "a typed code reads");
ok(G.code({ r: "B", c: "" }) === "B-" && G.code({ r: "", c: "4" }) === "-4", "half a grade");
ok(G.norm({ r: "", c: "" }) === null && G.norm(null) === null && G.norm([]) === null && G.norm("") === null, "nothing is no grade");
ok(G.norm({ r: "G", c: "7" }) === null && G.norm({ r: "<b>", c: "1" }).r === "", "values outside the scale are dropped");
ok(G.norm({ r: "A", c: 1 }).c === "1", "a numeric credibility from a file reads");
ok(G.norm({ r: "A", c: "1", at: "2026-10-19T07:00:00.000Z" }).at === "2026-10-19T07:00:00.000Z" && !("at" in G.norm({ r: "A", c: "1", at: "x<script>" })), "the time is kept only when it is a time");
ok(!("ai" in G.norm({ r: "A", c: "1", ai: true, by: "auto" })), "only r, c and at are kept");
ok(G.meaning({ r: "B", c: "2" }) === "B: Usually reliable; 2: Probably true", "meaning", G.meaning({ r: "B", c: "2" }));
ok(/Credibility not graded/.test(G.meaning({ r: "B" })), "meaning of half a grade");

ok(G.sourceKey("https://www.Reuters.com/world/asia/x", "Reuters") === "d:reuters.com", "domain without www");
ok(G.sourceKey("https://m.bangkokpost.com/news", "") === "d:bangkokpost.com", "mobile host folds into the domain");
ok(G.sourceKey("http://user@evil.example.org:8080/p", "") === "d:evil.example.org", "credentials and port are not part of the key");
ok(G.sourceKey("", "  Royal Thai   Army ") === "n:royal thai army", "no link: the name");
ok(G.sourceKey("javascript:alert(1)", "") === "", "a non-web link with no name gives no key");
ok(G.sourceKey("", "__proto__") === "n:__proto__", "keys are prefixed so __proto__ cannot clash");
ok(G.sourceLabel("d:reuters.com") === "reuters.com", "label");
const D = G.normDefaults({ "d:reuters.com": { r: "B", at: "2026-10-19T00:00:00Z" }, "bad": { r: "A" }, "d:x.com": { r: "Z" }, "n:y": "A" });
ok(Object.keys(D).join() === "d:reuters.com" && D["d:reuters.com"].r === "B" && D["d:reuters.com"].label === "reuters.com", "defaults are cleaned", D);
ok(Object.keys(G.normDefaults({ "d:<img>": { r: "A" }, "d:nodot": { r: "A" } })).length === 0, "a domain key must look like a domain");
ok(G.norm({ r: "e", c: "5" }).r === "E", "a lower-case letter reads");
ok(Object.keys(G.normDefaults([{ r: "A" }])).length === 0 && Object.keys(G.normDefaults(null)).length === 0, "defaults that are not a map are dropped");

const b = G.badge({ r: "B", c: "2" });
ok(/>B2<\/span>$/.test(b) && /Usually reliable/.test(b), "badge");
ok(G.badge(null) === "", "no badge without a grade");

const p0 = G.picker("0123456789abcdef", null, null, "");
ok(/data-wkg="0123456789abcdef"/.test(p0) && /data-wkg-r/.test(p0) && /data-wkg-c/.test(p0), "picker has both selects");
ok(!/selected title/.test(p0.replace(/<option value=""[^>]*>/g, "")), "an ungraded picker selects nothing");
ok(/Completely reliable/.test(p0) && /Confirmed by other sources/.test(p0) && /<details class="wkghelp">/.test(p0), "picker carries the legend");
const p1 = G.picker("k", null, { r: "C" }, "example.com");
ok(/value="C" selected/.test(p1) && /class="wkgsug"/.test(p1) && /data-wkg-ok/.test(p1) && /Not stored until you confirm/.test(p1), "a source default only pre-fills, marked, with Confirm");
ok(!/wkgb/.test(p1), "a pre-filled default shows no badge (nothing stored yet)");
const p2 = G.picker("k", { r: "A", c: "2" }, { r: "C" }, "example.com");
ok(/value="A" selected/.test(p2) && /value="2" selected/.test(p2) && !/data-wkg-ok/.test(p2) && /data-wkg-def/.test(p2), "a stored grade wins over the default and offers to make it the default");
const p3 = G.picker("k", { r: "C", c: "2" }, { r: "C" }, "example.com");
ok(!/data-wkg-def/.test(p3), "no default button when the default already matches");
const px = G.picker('"><img src=x onerror=alert(1)>', null, { r: "B" }, '<img src=x onerror=alert(2)>');
ok(!/<img/.test(px), "picker escapes the key and the source label");

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
