// Probe 25 (27 Nov 2026): page structure for the reader (Kremlin, White House), UK written statement API, China MFA list links.
const { UA } = await import("./dense_lib.mjs");
const get = async (u) => { const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) }); return [r.status, await r.text(), r.headers.get("content-type")]; };
const show = (t, re, n = 700) => { const i = t.search(re); console.log("P   @", re, i, i >= 0 ? t.slice(i, i + n).replace(/\s+/g, " ") : ""); };
let [s, t] = await get("http://en.kremlin.ru/events/president/news/81350");
console.log("P kremlin", s, t.length); show(t, /class="[^"]*(entry-content|read__content|text|article)/); show(t, /<time|datetime=|class="read__published/); show(t, /og:title|<h1/, 300); show(t, /<p[ >]/, 500);
const wh = await get("https://www.whitehouse.gov/briefings-statements/feed/"); const l = (wh[1].match(/<link>(https:\/\/www\.whitehouse\.gov\/[^<]+)<\/link>/g) || []).slice(1, 6).map((x) => x.replace(/<\/?link>/g, ""));
console.log("P wh links", l.join(" "));
const rm = await get("https://www.whitehouse.gov/remarks/feed/"); console.log("P wh remarks", (rm[1].match(/<link>(https:\/\/www\.whitehouse\.gov\/[^<]+)<\/link>/g) || []).slice(1, 4).join(" "));
if (l[0]) { [s, t] = await get(l[0]); console.log("P wh page", s, t.length); show(t, /class="[^"]*(entry-content|wp-block-post-content|body-content)/); show(t, /article:published_time|<time/, 300); show(t, /og:title/, 200); }
[s, t] = await get("https://questions-statements-api.parliament.uk/api/writtenstatements/statements?take=2&expandMember=true"); const j = JSON.parse(t);
console.log("P uk", s, JSON.stringify(j.results[0].value).slice(0, 1200)); console.log("P uk links", JSON.stringify(j.results[0].links || j.results[0]).slice(0, 300));
[s, t] = await get("https://www.fmprc.gov.cn/eng/xw/fyrbt/");
console.log("P mfa", [...t.matchAll(/href="([^"]+)"[^>]*>([^<]*)</g)].map((m) => m[1] + " " + m[2].trim().slice(0, 80)).filter((x) => /t20|fyrbt\/\d|\.\/\d/.test(x)).slice(0, 10).join(" | "));
show(t, /t20\d{6}_/, 600);
