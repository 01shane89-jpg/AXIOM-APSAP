// Probe 27 (27 Nov 2026): the official-statements branch against the real sources.
const { get } = await import("./dense_lib.mjs");
const { statementItems } = await import("./dense_statements.mjs");
const { ruleFor, extract } = await import("./fulltext_lib.mjs");
const { parseList } = await import("./feedparse.mjs");
const j = await get("https://questions-statements-api.parliament.uk/api/writtenstatements/statements?take=60&expandMember=true", "json", { timeout: 60000 });
const I = statementItems(j.results); console.log("P uk items", I.length, "non-gb", I.filter((i) => i.ccs.length > 1).length);
for (const it of I.slice(0, 3)) console.log("P  ", JSON.stringify(it).slice(0, 500));
const ua = { headers: { "user-agent": "AXIOM-OSAP open-licence reader (+https://osap.axiom-intelligence-systems.com)" } };
const rd = async (u) => { const r = ruleFor(u); const src = r.api ? r.api(u) : u; const x = await fetch(src, ua); const t = await x.text(); const e = extract(r, t, u); console.log("P read", r.id, x.status, src.slice(0, 110), e.why || (e.title + " | " + e.pub + " | " + JSON.stringify(e.by) + " | blocks " + e.blocks.length + " chars " + e.chars + " | " + JSON.stringify(e.blocks.slice(0, 3)).slice(0, 400))); };
await rd(I[0].url); await rd(I[1].url);
const wh = await (await fetch("https://www.whitehouse.gov/briefings-statements/feed/", ua)).text();
const links = (wh.match(/<link>(https:\/\/www\.whitehouse\.gov\/briefings-statements\/[^<]+)<\/link>/g) || []).map((x) => x.replace(/<\/?link>/g, ""));
console.log("P wh links matching rule", links.filter((l) => ruleFor(l)).length, "of", links.length);
for (const l of links.slice(0, 2)) await rd(l);
const rm = await (await fetch("https://www.whitehouse.gov/remarks/feed/", ua)).text(); const rl = (rm.match(/<link>(https:\/\/www\.whitehouse\.gov\/remarks\/[^<]+)<\/link>/g) || []).map((x) => x.replace(/<\/?link>/g, "")); if (rl[0]) await rd(rl[0]);
const mf = await (await fetch("https://www.fmprc.gov.cn/eng/xw/fyrbt/", ua)).text();
const L = parseList(mf, "https://www.fmprc.gov.cn/eng/xw/fyrbt/", "^\\./[a-z]+/\\d{6}/t\\d{8}_\\d+\\.html$");
console.log("P mfa", L.length, JSON.stringify(L.slice(0, 3).map((x) => [x.title, x.date, x.link])));
