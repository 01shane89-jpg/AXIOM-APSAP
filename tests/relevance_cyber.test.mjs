// Cyber intrusion headlines reach the news pool and the "Cyber attacks" data set (tools/relevance.json, tools/topics.json).
// 2026-11-16/17: The Japan Times ran "Japan's most powerful supercomputer hit by unauthorized access" (RIKEN's Fugaku). The
// headline matched no relevance word, so it was left out before it reached Japan's news, and two other Fugaku headlines were
// kept without the Cyber attacks tag. Usage: node tests/relevance_cyber.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileRelevance, relevance, compileTopics, topicsOf, kept } from "../tools/topics_lib.mjs";

const topics = JSON.parse(fs.readFileSync("tools/topics.json", "utf8")).topics;
const R = compileRelevance(JSON.parse(fs.readFileSync("tools/relevance.json", "utf8")), topics);
const T = compileTopics(topics);
const cyber = (t) => topicsOf(T, t, ["jp"]).includes("cyber");

for (const t of [
  "Japan's most powerful supercomputer hit by unauthorized access",
  "Riken reports damage to police for unauthorized access to Fugaku",
  "Hospital hit by cyber incident, servers down",
  "Malware found on government servers",
  "Ministry website hacked overnight",
]) {
  assert.equal(relevance(R, t), "strong", "kept as a security headline: " + t);
  assert.ok(cyber(t), "tagged Cyber attacks: " + t);
}
for (const t of ["User Info of Fugaku Supercomputer May Have Been Leaked", "Breach of Japan's Fugaku supercomputer exposes security spending gap", "Bank outage leaves customers unable to pay"])
  assert.ok(kept(relevance(R, t)), "kept: " + t);
// sport and celebrity still leave the pool
for (const t of ["Footballer signs new contract", "Pop star wedding highlights"]) assert.ok(!kept(relevance(R, t)), "left out: " + t);
// NHK moved its RSS off www3.nhk.or.jp (frozen on 2026-08-08)
const feeds = fs.readFileSync("tools/news_feeds.json", "utf8");
assert.ok(!feeds.includes("www3.nhk.or.jp/rss/news/cat0.xml"), "NHK News reads the live feed");
console.log("cyber relevance ok");
