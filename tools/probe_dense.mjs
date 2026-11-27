// Probe 26 (27 Nov 2026): UK written statement detail and page addresses; licence page.
const { UA } = await import("./dense_lib.mjs");
const get = async (u) => { const r = await fetch(u, { headers: { "user-agent": UA, accept: "application/json,text/html" }, signal: AbortSignal.timeout(30000) }); return [r.status, await r.text(), r.headers.get("content-type"), r.url]; };
for (const u of ["https://questions-statements-api.parliament.uk/api/writtenstatements/statements/2026-11-26/HLWS519?expandMember=true",
  "https://questions-statements-api.parliament.uk/api/writtenstatements/statements/1964599?expandMember=true",
  "https://questions-statements.parliament.uk/written-statements/detail/2026-11-26/HLWS519",
  "https://www.parliament.uk/site-information/copyright-parliament/open-parliament-licence/",
  "https://www.whitehouse.gov/copyright/"]) {
  try { const [s, t, ct, ru] = await get(u); const x = /json/.test(ct || "") ? t : t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const i = Math.max(0, x.search(/commercial|public domain|"text"|licen/i) - 200);
    console.log("P ==", u, s, ct, ru !== u ? "-> " + ru : "", t.length, "|", x.slice(i, i + 900)); } catch (e) { console.log("P ==", u, "ERR", e.message); }
}
