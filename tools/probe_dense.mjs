// Probe 43 (27 Nov 2026): GLEIF parent-country filter syntax.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const get = async (u) => { const r = await fetch(u, { headers: { "user-agent": UA, accept: "application/vnd.api+json" } }); const t = await r.text(); return [r.status, t]; };
const m = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
for (const u of [
  "https://api.gleif.org/api/v1/lei-records?filter[ultimateParent.addresses.country]=CN&page[size]=1",
  "https://api.gleif.org/api/v1/lei-records?filter[ultimateParent.addresses.country]=CN&filter[entity.legalAddress.country]=DE&page[size]=1",
  "https://api.gleif.org/api/v1/lei-records?filter[ultimateParent.addresses.country]=CN&filter[registration.initialRegistrationDate]=>" + m + "&page[size]=1",
  "https://api.gleif.org/api/v1/lei-records?filter[directParent.addresses.country]=CN&filter[registration.initialRegistrationDate]=>" + m + "&page[size]=1",
  "https://api.gleif.org/api/v1/lei-records?filter[ultimateParent.addresses.country]=CN&sort=-registration.initialRegistrationDate&page[size]=3",
]) { const [s, t] = await get(u); const j = (() => { try { return JSON.parse(t); } catch { return {}; } })();
  console.log("P ==", s, u, "total", j.meta && j.meta.pagination && j.meta.pagination.total, (j.data || []).map((d) => d.attributes.entity.legalName.name + " " + d.attributes.entity.legalAddress.country + " " + d.attributes.registration.initialRegistrationDate.slice(0, 10)).join(" | "), s >= 400 ? t.slice(0, 300) : "");
  await new Promise((r) => setTimeout(r, 1100)); }
