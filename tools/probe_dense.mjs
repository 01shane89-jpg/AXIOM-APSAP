// Probe 41 (27 Nov 2026): GLEIF filter fields and relationship endpoints.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const get = async (u) => { const r = await fetch(u, { headers: { "user-agent": UA, accept: "application/vnd.api+json" } }); const t = await r.text(); return [r.status, t]; };
const [, f] = await get("https://api.gleif.org/api/v1/fields?page[size]=500");
for (const d of JSON.parse(f).data) { const a = d.attributes; if ((a.contexts || []).length && /arent|elation|categor|owns|owned|Date|child|conform/i.test(a.field + d.id)) console.log("P F", d.id, a.field, (a.contexts || []).join("/"), (a.operators || []).join("/")); }
const wk = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
for (const u of [
  "https://api.gleif.org/api/v1/relationship-records?filter[relationship.type]=IS_ULTIMATELY_CONSOLIDATED_BY&filter[registration.initialRegistrationDate]=>" + wk + "&page[size]=2",
  "https://api.gleif.org/api/v1/lei-records?filter[entity.legalAddress.country]=CN&filter[registration.initialRegistrationDate]=>" + wk + "&page[size]=1",
  "https://api.gleif.org/api/v1/lei-records/549300FFC0ZUJKJ8GZ78/ultimate-parent-relationship",
  "https://api.gleif.org/api/v1/lei-records/529900O1G3JIKB4U3J62/direct-parent",
]) { const [s, t] = await get(u); console.log("P ==", s, u); console.log("P   ", t.slice(0, 1500).replace(/\s+/g, " ")); await new Promise((r) => setTimeout(r, 1100)); }
