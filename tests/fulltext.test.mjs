// Open-licence full text (tools/fulltext_lib.mjs): which addresses may be read, how a page becomes text, and that nothing
// from the page can run or leak through. Run: node tests/fulltext.test.mjs
import assert from "node:assert/strict";
import { RULES, ruleFor, shardOf, fnv, decode, blocks, extract, innerAt, shardJs, SHARDS, API_PREFIXES } from "../tools/fulltext_lib.mjs";
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
  for (const r of RULES) { assert.ok(r.lic && /^https:\/\//.test(r.licUrl) && (r.http ? /^https?:\/\// : /^https:\/\//).test(r.terms) && r.note, r.id); assert.ok(!/\bNC\b|non-?commercial/i.test(r.lic), r.id); }
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
t("White House statements and remarks, and UK written ministerial statements through Parliament's API", () => {
  assert.equal(ruleFor("https://www.whitehouse.gov/briefings-statements/2026/11/congressional-bills-h-r-1550-signed-into-law/").id, "whitehouse");
  assert.equal(ruleFor("https://www.whitehouse.gov/remarks/2026/10/remarks-by-director-michael-kratsios-at-the-summit/").id, "whitehouse");
  for (const u of ["https://www.whitehouse.gov/", "https://www.whitehouse.gov/briefings-statements/", "https://www.whitehouse.gov/copyright/", "http://www.whitehouse.gov/remarks/2026/10/x/",
    "https://questions-statements.parliament.uk/written-questions/detail/2026-11-26/HL123", "https://questions-statements.parliament.uk/written-statements/detail/2026-11-26/../x"]) assert.equal(ruleFor(u), null, u);
  const uk = ruleFor("https://questions-statements.parliament.uk/written-statements/detail/2026-11-26/hlws519");
  assert.equal(uk.id, "ukparl-statements");
  assert.equal(uk.api("https://questions-statements.parliament.uk/written-statements/detail/2026-11-26/hlws519"), "https://questions-statements-api.parliament.uk/api/writtenstatements/statements/2026-11-26/HLWS519?expandMember=true");
  const text = "<p>My Honourable Friend the Minister has today made the following statement:</p><p>" + "Local government is at the heart of this Government's ambition. ".repeat(6) + "</p><script>alert(1)</script>";
  const e = extract(uk, JSON.stringify({ value: { title: "Local Government Finance", text, dateMade: "2026-11-26T00:00:00", house: "Lords", memberRole: "Minister for Housing and Local Government",
    member: { name: "Baroness Taylor of Stevenage" }, answeringBodyName: "Ministry of Housing, Communities and Local Government" } }), "https://questions-statements.parliament.uk/written-statements/detail/2026-11-26/HLWS519");
  assert.equal(e.title, "Local Government Finance"); assert.equal(e.pub, "2026-11-26");
  assert.deepEqual(e.by, [{ n: "Baroness Taylor of Stevenage", r: "Minister for Housing and Local Government" }, { n: "Ministry of Housing, Communities and Local Government", r: "House of Lords" }]);
  assert.equal(e.blocks.length, 2); assert.ok(!JSON.stringify(e).includes("alert"));
  assert.equal(extract(uk, "<html>Just a moment...</html>", "x").why, "not an API answer");
  const wh = '<html><head><meta property="og:title" content="Congressional Bills Signed into Law"><meta property="article:published_time" content="2026-11-25T12:01:00+00:00"></head><body><nav><p>Menu</p></nav>' +
    '<div class="entry-content wp-block-post-content has-global-padding"><div class="wp-block-whitehouse-topper"><h1 class="x">Congressional Bills Signed into Law</h1></div><p>' + "On Tuesday, the President signed into law the following bills. ".repeat(5) + '</p><figure><img src="a.jpg"><figcaption>Official photo</figcaption></figure></div><footer><p>Footer</p></footer></body></html>';
  const w = extract(ruleFor("https://www.whitehouse.gov/briefings-statements/2026/11/bills/"), wh, "https://www.whitehouse.gov/briefings-statements/2026/11/bills/");
  assert.equal(w.title, "Congressional Bills Signed into Law"); assert.equal(w.pub, "2026-11-25T12:01:00+00:00"); assert.deepEqual(w.by, [{ n: "The White House", r: "" }]);
  assert.deepEqual(w.blocks.map((b) => b.k), ["h", "p"]); assert.ok(!/Menu|Footer|Official photo/.test(JSON.stringify(w)));
  assert.ok(API_PREFIXES.every((p) => /^https:\/\/[^/]+\/api\//.test(p)));
});
t("Kremlin (Shane 27 Nov: plain http for this publisher only): readouts and transcripts, article body, date", () => {
  assert.equal(ruleFor("http://en.kremlin.ru/events/president/news/81350").id, "kremlin");
  assert.equal(ruleFor("https://kremlin.ru/events/president/transcripts/81342").id, "kremlin");
  for (const u of ["http://en.kremlin.ru/about/copyrights", "http://en.kremlin.ru:8080/events/president/news/1", "http://user@en.kremlin.ru/events/president/news/1", "http://evil.example/events/president/news/1",
    "http://www.gov.uk/government/news/x", "http://www.whitehouse.gov/remarks/2026/10/x/", "ftp://en.kremlin.ru/events/president/news/1"]) assert.equal(ruleFor(u), null, u);
  assert.ok(RULES.filter((r) => r.http).map((r) => r.id).join() === "kremlin", "only the Kremlin is read over http");
  const html = '<html><head><meta property="og:title" content="Conversation with President of Kazakhstan Kassym-Jomart Tokayev"></head><body><p>All content on this site is licensed under</p>' +
    '<time class="read__published" datetime="2026-11-25" itemprop="datePublished">November 25, 2026</time><div class="entry-content e-content read__internal_content" itemprop="articleBody">' +
    '<div class="slider"><div class="slide" data-cycle-desc="Before a conversation."><img src="x.jpg"></div></div><p>' + "Vladimir Putin had a telephone conversation with President of Kazakhstan. ".repeat(5) + "</p><p>President of Kazakhstan <a href=\"/catalog/persons/593/events\" class=\"person_tag read__tag\">Kassym-Jomart Tokayev<span class=\"read__tooltip tooltip_person hidden masha-ignore\"> <span class=\"tooltip__close\"><i></i></span> <span class=\"tooltip__name\">Tokayev Kassym-Jomart Kemelevich</span></span></a> discussed bilateral relations.</p></div><div class=\"footer\"><p>Footer</p></div></body></html>";
  const e = extract(ruleFor("http://en.kremlin.ru/events/president/news/81350"), html, "http://en.kremlin.ru/events/president/news/81350");
  assert.equal(e.title, "Conversation with President of Kazakhstan Kassym-Jomart Tokayev"); assert.equal(e.pub, "2026-11-25");
  assert.deepEqual(e.by, [{ n: "President of Russia", r: "Presidential Executive Office" }]); assert.equal(e.blocks.length, 2);
  assert.ok(!/licensed under|Footer|Before a conversation|Kemelevich/.test(JSON.stringify(e.blocks)));
  assert.ok(/President of Kazakhstan Kassym-Jomart Tokayev discussed bilateral relations\./.test(JSON.stringify(e.blocks)), JSON.stringify(e.blocks[1]));
  assert.ok(RULES.every((r) => r.id === "conversation" || r.credit), "every rule but The Conversation has its own credit line");
});
console.log(`${n} fulltext checks passed`);
