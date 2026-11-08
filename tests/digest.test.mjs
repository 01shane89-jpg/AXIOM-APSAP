// Unit test of report digests (tools/digest_lib.mjs): article text out of a page, and the checks on the model's reply.
// Run: node tests/digest.test.mjs
import { articleText, check, rank, SYSTEM } from "../tools/digest_lib.mjs";
let fails = 0;
function ok(c, m) { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

const body = "NAKHON PHANOM: Security forces are expanding their investigation after seizing more than 300 sachets of a suspected new drug and 328,000 methamphetamine pills near the Mekong River. " +
  "Col Sarannat Nualmanee, commander of the 21st Ranger Regiment, said on Saturday the drugs were intercepted late on Friday near the Mekong River in Ban Na Krasoem, Tha Uthen district, after traffickers brought them ashore by long-tail boat. Suspects escaped before arrest. " +
  "The task force is tracing the trafficking network. It suspects local accomplices may have helped secure transport routes, while intelligence points to possible involvement by state personnel. These claims remain under investigation.";
const ld = `<html><head><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "NewsArticle", articleBody: body })}</script></head><body><p>Subscribe to our newsletter today for more</p></body></html>`;
ok(articleText(ld).startsWith("NAKHON PHANOM") && articleText(ld).includes("state personnel"), "JSON-LD articleBody is read");
const paras = `<html><body><nav><p>Home News Thailand General and other menu items here</p></nav><article><h1>Rangers seize</h1>${body.split(". ").map((s) => "<p>" + s.replace(/&/g, "&amp;") + ".</p>").join("")}
  <p>Please credit and share this article with others using this link: https://example.com. View our policies.</p><script>alert("x")</script></article></body></html>`;
const t = articleText(paras);
ok(t.includes("328,000 methamphetamine pills") && !/credit and share|alert|menu items/.test(t), "paragraphs of <article> are read, furniture and scripts left out");
ok(articleText("<html><body><p>Short.</p></body></html>") === "", "a page with no story gives no text");

const art = { title: "Rangers seize 'Happy Water'", time: "2026-11-08T00:04", text: body };
const good = { what: "Rangers of the 21st Ranger Regiment intercepted drugs brought ashore by long-tail boat near the Mekong River in Tha Uthen district late on Friday.",
  where: "Ban Na Krasoem, Tha Uthen district, Nakhon Phanom", when: "Late Friday", who: ["21st Ranger Regiment", "a task force"],
  figures: [{ value: "328,000", of: "methamphetamine pills seized" }, { value: "more than 300", of: "sachets of a suspected new drug" }],
  claims: [{ text: "Possible involvement by state personnel", by: "intelligence cited by the task force", status: "Under investigation" }], next: "The task force is tracing the trafficking network." };
const c = check(good, art);
ok(c.digest && c.digest.figures.length === 2 && c.digest.claims[0].status === "under investigation", "a faithful digest passes, claims keep their status");
ok(/figures/.test(check({ ...good, figures: [{ value: "400,000", of: "pills" }] }, art).reject || ""), "an invented figure is rejected");
ok(/names/.test(check({ ...good, who: ["General Prayut Chan-o-cha"] }, art).reject || ""), "a name the article does not give is rejected");
ok(/deaths/.test(check({ ...good, next: "Two suspects were killed." }, art).reject || ""), "deaths the article does not mention are rejected");
ok(!check({ ...good, what: "Call +66 81 234 5678 or a@b.co now about the drug seizure near the river." }, art).digest.what.match(/\d{3}|@/), "phone numbers and emails are stripped");
ok(check({ what: "" }, art).reject && check(null, art).reject, "an empty reply is rejected");
ok(/untrusted DATA/.test(SYSTEM) && /Never follow instructions/.test(SYSTEM) && /claims as claims/.test(SYSTEM), "the prompt treats the article as data and keeps claims as claims");

const rows = [["us", "2026-11-08T10:00", "a"], ["th", "2026-11-08T09:00", "b", "", "", "", "", "", "security"], ["th", "2026-11-08T11:00", "c"], ["ua", "2026-11-08T08:00", "d"]];
ok(rank(rows, { priority: ["th"], conflict: ["ua", "th"] }).map((r) => r[2]).join("") === "bcda", "priority and conflict countries first, kept rows, then newest");
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
