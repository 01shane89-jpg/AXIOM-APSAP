// PROBE BRANCH ONLY: ReCAAP ISC site terms (for the incident list PDF).
const UA = "AXIOM-OSAP/1.0 (situational awareness; hourly; +https://github.com/01shane89-jpg/AXIOM-APSAP)";
const strip = (t) => t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
for (const u of ["https://www.recaap.org/terms", "https://www.recaap.org/privacy"]) {
  try { const r = await fetch(u, { headers: { "user-agent": UA } }); const t = strip(await r.text()); const i = t.search(/terms|copyright/i);
    console.log("PRT " + u + " " + r.status + " " + (t.match(/.{0,300}(copyright|reproduc|commercial|permission|intellectual|licen).{0,500}/gi) || []).slice(0, 5).join(" || ").slice(0, 3000)); } catch (e) { console.log("PRT " + u + " ERR " + e.message); }
}
