// PROBE BRANCH ONLY: The Conversation politics/world section feeds + CHMI/vedur licence pages.
const UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", accept: "*/*" };
const txt = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const ed = { us: ["politics", "world"], uk: ["politics", "world"], global: ["politics", "world", "conflict"], africa: ["politics", "world"], ca: ["politics", "world"], nz: ["politics", "world"], id: ["politik", "politik-masyarakat", "global"], fr: ["politique-societe", "international"], es: ["politica-y-sociedad", "internacional"], au: ["politics", "world"], europe: ["politics", "world"] };
for (const [e, secs] of Object.entries(ed)) for (const s of secs) {
  const u = "https://theconversation.com/" + e + "/" + s + "/articles.atom";
  try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) }); const t = await r.text(); const d = [...t.matchAll(/<updated>([^<]+)</g)].map((m) => Date.parse(m[1])).filter(Boolean).sort().pop(); console.log("CV " + r.status + " " + (t.match(/<entry\b/g) || []).length + " " + (d ? new Date(d).toISOString().slice(0, 10) : "-") + " " + u + " | " + ((t.match(/<entry>[\s\S]*?<title[^>]*>([^<]{0,100})/) || [])[1] || "")); } catch (er) { console.log("CV ERR " + u + " " + er.message); }
}
for (const u of ["https://theconversation.com/global/republishing-guidelines", "https://www.chmi.cz/files/portal/docs/hydro/denni_data/Podminky_uziti.pdf", "https://www.chmi.cz/o-nas/otevrena-data", "https://opendata.chmi.cz/meteorology/weather/alerts/cap/", "https://en.vedur.is/about-imo/the-met-office/data-policy/", "https://www.vedur.is/um-vi/upplysingar/gagnastefna/", "https://api.vedur.is/"]) {
  try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) }); const t = await r.text(); console.log("LIC " + r.status + " " + u + " | " + (txt(t).match(/.{0,200}(creative commons|CC BY[^ ]*|CC-BY|licen[cs]|commercial|komerční|licence).{0,250}/gi) || []).slice(0, 4).join(" || ").slice(0, 1400)); } catch (er) { console.log("LIC ERR " + u + " " + er.message); }
}
