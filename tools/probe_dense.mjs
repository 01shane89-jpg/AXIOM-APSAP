// Probe 31 (27 Nov 2026): Kremlin person-card markup and English feed links.
const ua = { headers: { "user-agent": "AXIOM-OSAP open-licence reader (+https://osap.axiom-intelligence-systems.com)" } };
const t = await (await fetch("http://en.kremlin.ru/events/president/news/81350", ua)).text();
const b = t.indexOf('itemprop="articleBody"'); const i = t.indexOf("Tokayev", t.indexOf("<p", b));
console.log("P html", t.slice(i - 700, i + 500).replace(/\s+/g, " "));
const f = await (await fetch("http://en.kremlin.ru/events/president/news/feed", ua)).text();
console.log("P feed", f.slice(f.indexOf("<item") , f.indexOf("<item") + 600).replace(/\s+/g, " "));
