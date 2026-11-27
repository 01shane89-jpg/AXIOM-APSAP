// Probe 51 (27 Nov 2026): UN Comtrade terms of use.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
for (const u of ["https://uncomtrade.org/docs/terms-of-use/", "https://uncomtrade.org/docs/policy-on-use-and-dissemination/", "https://comtradeplus.un.org/TermsOfUse", "https://uncomtrade.org/docs/licensing-and-usage/", "https://uncomtrade.org/docs/"]) {
  try { const r = await fetch(u, { headers: { "user-agent": UA } }); const t = (await r.text()).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    console.log("P ==", r.status, u, t.length);
    for (const k of ["commercial", "redistribut", "free of charge", "licen", "attribut", "subscription", "premium", "resale", "third part"]) { let i = -1, n = 0; while ((i = t.toLowerCase().indexOf(k, i + 1)) >= 0 && n++ < 3) console.log("P   ", k, "|", t.slice(Math.max(0, i - 220), i + 260)); }
    const links = [...new Set([...(await (await fetch(u, { headers: { "user-agent": UA } })).text()).matchAll(/href="([^"]*(term|polic|licen|usage)[^"]*)"/gi)].map((m) => m[1]))].slice(0, 10); console.log("P   LINKS", links.join(" "));
  } catch (e) { console.log("P ERR", u, e.message); }
  await new Promise((r) => setTimeout(r, 1000));
}
