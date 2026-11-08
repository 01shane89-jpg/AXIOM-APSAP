// PROBE BRANCH ONLY: JCG NAVAREA XI text.
const UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", accept: "*/*" };
const C = "https://www1.kaiho.mlit.go.jp/TUHO/keiho/cgi/";
for (const lang of ["JP", "EN", "ENG", "E", "en"]) {
  for (const how of ["GET", "POST"]) {
    try { const body = "TYPE=NAVAREA11&TANA=260498:&LANG=" + lang; const r = how === "GET" ? await fetch(C + "disp_warnings.cgi?" + body.replace(":", ""), { headers: UA }) : await fetch(C + "disp_warnings.cgi", { method: "POST", headers: { ...UA, "content-type": "application/x-www-form-urlencoded" }, body });
      const h = await r.text(); const b = h.slice(h.indexOf("<body")); console.log("DW " + lang + " " + how + " " + r.status + " " + h.length + " | " + b.replace(/\s+/g, " ").slice(0, 1600)); } catch (e) { console.log("DW ERR " + e.message); }
  }
}
for (const u of ["https://www1.kaiho.mlit.go.jp/TUHO/keiho/navarea11_eng.html", "https://www1.kaiho.mlit.go.jp/TUHO/keiho/e_navarea11.html", "https://www1.kaiho.mlit.go.jp/jhd-E.html"]) { try { const r = await fetch(u, { headers: UA }); const h = await r.text(); console.log("EP " + r.status + " " + u + " | " + [...new Set([...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((x) => /keiho|navarea|TUHO/i.test(x)))].slice(0, 20).join(" ")); } catch (e) { console.log("EP ERR " + e.message); } }
