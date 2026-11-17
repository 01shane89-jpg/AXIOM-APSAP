// Open-licence full text (tools/fulltext_lib.mjs): which addresses may be read, how a page becomes text, and that nothing
// from the page can run or leak through. Run: node tests/fulltext.test.mjs
import assert from "node:assert/strict";
import { RULES, ruleFor, shardOf, fnv, decode, blocks, extract, innerAt, shardJs, SHARDS } from "../tools/fulltext_lib.mjs";
let n = 0; const t = (name, f) => { f(); n++; console.log("ok " + name); };

t("only listed publishers' article addresses, https, no credentials or odd ports", () => {
  assert.equal(ruleFor("https://theconversation.com/why-x-matters-296418").id, "conversation");
  assert.equal(ruleFor("https://www.theconversation.com/why-x-matters-296418").id, "conversation");
  assert.equal(ruleFor("https://www.gov.uk/foreign-travel-advice/andorra").id, "govuk");
  assert.equal(ruleFor("https://www.gov.uk/government/news/some-news-item").id, "govuk");
  for (const u of ["http://theconversation.com/why-x-matters-296418", "https://theconversation.com/global/republishing-guidelines", "https://evil.com/theconversation.com/x-1",
    "https://theconversation.com.evil.com/x-1", "https://user:pw@theconversation.com/x-1", "https://theconversation.com:8443/x-1", "https://www.gov.uk/guidance/x",
    "https://www.lowyinstitute.org/the-interpreter/x", "javascript:alert(1)", "not a url", ""]) assert.equal(ruleFor(u), null, u);
  // every rule names its licence, where it is stated, and allows commercial reuse (no NC licence may be listed)
  for (const r of RULES) { assert.ok(r.lic && /^https:\/\//.test(r.licUrl) && /^https:\/\//.test(r.terms) && r.note, r.id); assert.ok(!/\bNC\b|non-?commercial/i.test(r.lic), r.id); }
});
t("shards are stable and in range", () => {
  assert.equal(fnv("a"), 0xe40c292c);
  const k = shardOf("https://theconversation.com/x-1"); assert.match(k, /^[0-9a-f]{2}$/); assert.ok(parseInt(k, 16) < SHARDS);
});
t("entities decode, bad code points do not", () => {
  assert.equal(decode("Tom &amp; Jerry &#8217;s &#x2014; &nbsp;&lt;b&gt; &#0; &#xD800; &bogus;"), "Tom & Jerry ’s —  <b>   &bogus;");
});
t("blocks keep text and https links, drop scripts, styles, figures, forms and unsafe links", () => {
  const B = blocks('<p>Hi <a href="https://a.org/x">there</a>, <a href="javascript:alert(1)">bad</a> <a href="/rel">rel</a></p>' +
    '<script>alert(1)</script><style>p{}</style><figure><img src=x onerror=alert(1)><figcaption>Photo: AP</figcaption></figure>' +
    '<h2>Head</h2><ul><li>One</li><li>Two <b>bold</b></li></ul><blockquote><p>Quoted</p></blockquote><form><p>Sign up</p></form><!-- <p>hidden</p> -->', "https://theconversation.com/x-1");
  assert.deepEqual(B[0], { k: "p", s: ["Hi ", ["there", "https://a.org/x"], ", bad ", ["rel", "https://theconversation.com/rel"]] });
  assert.deepEqual(B.map((b) => b.k), ["p", "h", "li", "li", "p"]);
  assert.equal(B[3].s[0], "Two bold");
  const all = JSON.stringify(B); for (const bad of ["alert", "Photo: AP", "Sign up", "hidden", "onerror"]) assert.ok(!all.includes(bad), bad);
});
t("innerAt matches nested tags of the same name", () => {
  const h = '<div id="a"><div>in</div><p>x</p></div><div>out</div>';
  assert.equal(innerAt(h, 0), "<div>in</div><p>x</p>");
});
t("The Conversation: article body, every author with role, dates; bot checks and empty pages refused", () => {
  const body = "<p>" + "Long enough sentence for the test. ".repeat(10) + "</p><p>Second.</p>";
  const html = '<html><head><meta property="og:title" content="A &amp; B"><meta property="article:published_time" content="2026-11-12T18:21:00Z"></head><body>' +
    '<span class="fn author-name" itemprop="name"> Jane Example </span></a><p class="role"> Lecturer, Example University </p>' +
    '<span class="fn author-name" itemprop="name">Sam Sample</span><p class="role">Professor, Sample Institute</p>' +
    '<div class="content-body" itemprop="articleBody">' + body + '<div class="promo"><p>Inline</p></div></div><div><p>Sidebar not article</p></div></body></html>';
  const e = extract(RULES[0], html, "https://theconversation.com/a-1");
  assert.equal(e.title, "A & B"); assert.equal(e.pub, "2026-11-12T18:21:00Z");
  assert.deepEqual(e.by, [{ n: "Jane Example", r: "Lecturer, Example University" }, { n: "Sam Sample", r: "Professor, Sample Institute" }]);
  assert.equal(e.blocks.length, 3); assert.ok(!JSON.stringify(e.blocks).includes("Sidebar"));
  assert.equal(extract(RULES[0], '<html><script src="/_Incapsula_Resource?x"></script></html>', "https://theconversation.com/a-1").why, "bot check");
  assert.equal(extract(RULES[0], "<html><body><p>nothing</p></body></html>", "https://theconversation.com/a-1").why, "no article found");
});
t("GOV.UK Content API: every part of a guide under its heading, the organisation, the latest change", () => {
  const api = JSON.stringify({ title: "Andorra travel advice", first_published_at: "2012-12-13T00:00:00+00:00", public_updated_at: "2025-12-10T12:46:46+00:00",
    details: { change_description: "New entry rules.", parts: [{ title: "Warnings & insurance", body: "<p>" + "Insurance text. ".repeat(10) + "</p>" }, { title: "Entry requirements", body: "<p>" + "Passport text. ".repeat(10) + '</p><script>x</script>' }] },
    links: { organisations: [{ title: "Foreign, Commonwealth & Development Office" }] } });
  const e = extract(RULES[1], api, "https://www.gov.uk/foreign-travel-advice/andorra");
  assert.equal(e.title, "Andorra travel advice"); assert.equal(e.change, "New entry rules.");
  assert.deepEqual(e.by, [{ n: "Foreign, Commonwealth & Development Office", r: "" }]);
  assert.deepEqual(e.blocks.map((b) => b.k), ["h", "p", "h", "p"]); assert.equal(e.blocks[0].s[0], "Warnings & insurance");
  assert.equal(RULES[1].api("https://www.gov.uk/foreign-travel-advice/andorra/"), "https://www.gov.uk/api/content/foreign-travel-advice/andorra");
  assert.equal(extract(RULES[1], "<html>not json</html>", "https://www.gov.uk/x").why, "not a Content API answer");
});
t("shard files cannot close the script tag or break on line separators", () => {
  const js = shardJs("0a", { u: { blocks: [{ k: "p", s: ["</script><script>alert(1)</script> x"] }] } });
  assert.ok(!js.includes("</script>")); assert.ok(!js.includes(" "));
  const w = {}; new Function("window", js)(w); assert.equal(w.OSAP_FT["0a"].u.blocks[0].s[0], "</script><script>alert(1)</script> x");
});
console.log(`${n} fulltext checks passed`);
