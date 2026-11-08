// PROBE BRANCH ONLY: licence pages for cz/is/lv/ro/il warning feeds.
const UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", accept: "*/*" };
const txt = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const RX = /.{0,220}(creative commons|CC[ -]BY[^ ]*|CC0|licen[cs]|commercial|komerční|licenc|atribu|leyf|notkun|ייחוס|מסחרי|comercial|komerci|Podmínk).{0,260}/gi;
const U = [
 "https://opendata.chmi.cz/", "https://opendata.chmi.cz/meteorology/", "https://opendata.chmi.cz/LICENSE", "https://opendata.chmi.cz/README.md",
 "https://www.chmi.cz/files/portal/docs/hydro/denni_data/Podminky_uziti.pdf", "https://www.chmi.cz/historicka-data/pocasi/denni-data/Denni-data-dle-z.-123-1998-Sb", "https://www.chmi.cz/o-nas/podminky-uziti",
 "https://en.vedur.is/about-imo/the-web/conditions", "https://www.vedur.is/um-vi/vefurinn/skilmalar", "https://api.vedur.is/cap/v1/",
 "https://videscentrs.lvgmc.lv/", "https://www.lvgmc.lv/lapas/datu-izmantosanas-noteikumi", "https://videscentrs.lvgmc.lv/lapas/autortiesibas", "https://data.gov.lv/dati/lv/organization/lvgmc",
 "https://www.meteoromania.ro/termeni-si-conditii/", "https://www.meteoromania.ro/despre-noi/", "https://www.meteoromania.ro/avertizari-xml.php",
 "https://ims.gov.il/en/termsOfUse", "https://ims.gov.il/he/termsOfUse", "https://ims.gov.il/en/ObservationDataAPI",
];
for (const u of U) {
  try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) }); const b = Buffer.from(await r.arrayBuffer()); const t = txt(b.toString("utf8"));
    console.log("LIC " + r.status + " " + b.length + " " + r.url + " | " + ((t.match(RX) || []).slice(0, 5).join(" || ") || t.slice(0, 300)).slice(0, 1800)); } catch (er) { console.log("LIC ERR " + u + " " + er.message); }
}
