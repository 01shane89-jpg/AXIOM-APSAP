// Probe 30 (27 Nov 2026): Kremlin pages through the reader rule (http).
const { ruleFor, extract } = await import("./fulltext_lib.mjs");
const ua = { headers: { "user-agent": "AXIOM-OSAP open-licence reader (+https://osap.axiom-intelligence-systems.com)" } };
const feed = await (await fetch("http://en.kremlin.ru/events/president/news/feed", ua)).text();
const links = [...feed.matchAll(/<link>(http:\/\/en\.kremlin\.ru\/events\/president\/news\/\d+)<\/link>/g)].map((m) => m[1]);
console.log("P links", links.length, "match", links.filter((l) => ruleFor(l)).length);
for (const u of [...links.slice(0, 3), "http://kremlin.ru/events/president/news/81350"]) {
  const r = await fetch(u, ua); const t = await r.text(); const e = extract(ruleFor(u), t, u);
  console.log("P read", u, r.status, r.url === u ? "" : "-> " + r.url, e.why || (e.title + " | " + e.pub + " | blocks " + e.blocks.length + " chars " + e.chars + " | " + JSON.stringify(e.blocks.slice(0, 2)).slice(0, 300)));
}
