// PROBE BRANCH ONLY: lv warning CSVs, chmi metadata + latest weather CAP.
const UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", accept: "*/*" };
const show = async (u, n = 1500, tail = 0) => { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) }); const t = await r.text(); console.log("PR " + r.status + " " + t.length + " " + u + " | " + t.slice(0, n) + (tail ? " ...TAIL... " + t.slice(-tail) : "")); return t; } catch (er) { console.log("PR ERR " + u + " " + er.message); return ""; } };
const B = "https://data.gov.lv/dati/dataset/c971bd44-5a51-46fb-9343-495fb1006287/resource/";
await show(B + "59c111fb-8c9a-4a63-8284-0a64a2920681/download/bridinajumu_metadata.csv", 1500, 1500);
await show(B + "995139f7-ec05-489a-b2bb-732d5cf7ca7b/download/bridinajumu_novadi.csv", 800, 600);
await show(B + "01dc7d3c-34e5-4cc3-8f1a-aaf022872a02/download/bridinajumu_poligoni.csv", 300);
await show("https://data.gov.lv/dati/api/3/action/package_show?id=c971bd44-5a51-46fb-9343-495fb1006287", 3000);
const md = await show("https://opendata.chmi.cz/meteorology/weather/alerts/metadata/", 1200);
for (const m of md.matchAll(/href="([^"./][^"]+)"/g)) await show("https://opendata.chmi.cz/meteorology/weather/alerts/metadata/" + m[1], 2500);
const dir = await fetch("https://opendata.chmi.cz/meteorology/weather/alerts/cap/", { headers: UA }).then((r) => r.text());
const rows = [...dir.matchAll(/href="(alert_cap_(\d+)_\d+\.xml)">[^<]*<\/a>\s+(\S+ \S+)\s+(\d+)/g)].map((m) => ({ f: m[1], k: m[2], t: Date.parse(m[3].replace(/-/g, " ")), n: +m[4] }));
const kinds = {}; for (const r of rows) (kinds[r.k] ||= []).push(r);
for (const [k, a] of Object.entries(kinds)) { a.sort((x, y) => x.t - y.t); const l = a[a.length - 1]; console.log("CK " + k + " count " + a.length + " newest " + l.f + " " + new Date(l.t).toISOString() + " " + l.n); }
const w = (kinds["50"] || []).sort((x, y) => x.t - y.t).pop(); if (w) { const t = await show("https://opendata.chmi.cz/meteorology/weather/alerts/cap/" + w.f, 200); const inf = t.split("<info>").slice(1).filter((s) => /<language>(en|cs)/.test(s)); console.log("CI infos " + inf.length); for (const s of inf.slice(0, 12)) console.log("CI " + ["language", "event", "severity", "onset", "expires", "areaDesc"].map((k) => (s.match(new RegExp("<" + k + ">([^<]*)")) || [])[1]).join(" | ")); }
