// PROBE BRANCH ONLY: UKHO detail + terms, AMSA MSI app, JCG open-data resource, India NAVAREA VIII.
const UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", accept: "*/*" };
const txt = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const g = async (u) => { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }); return [r, await r.text()]; };
try { const [r, h] = await g("https://msi.admiralty.co.uk/RadioNavigationalWarnings"); const i = h.indexOf('id="collapse_0"'); console.log("UK1 " + h.slice(i, i + 3000).replace(/\s+/g, " "));
  const refs = [...h.matchAll(/id="Reference_\d+" class="td-1">\s*([^<]+?)\s*</g)].map((m) => m[1]); console.log("UK2 n=" + refs.length + " " + refs.join(" | ")); } catch (e) { console.log("UK ERR " + e.message); }
for (const u of ["https://msi.admiralty.co.uk/RadioNavigationalWarnings/About", "https://msi.admiralty.co.uk/Home/TermsAndConditions", "https://msi.admiralty.co.uk/Terms", "https://www.amsa.gov.au/copyright"]) {
  try { const [r, h] = await g(u); const t = txt(h); console.log("TERMS " + r.status + " " + u + " | " + ((t.match(/.{0,250}(copyright|licen[cs]|Crown|reproduc|commercial|Creative Commons).{0,300}/gi) || []).slice(0, 4).join(" || ")).slice(0, 1500)); } catch (e) { console.log("TERMS ERR " + u + " " + e.message); }
}
for (const u of ["https://www.operations.amsa.gov.au/AMSA.Web.MSIPublication/Home", "https://data.e-gov.go.jp/data/en/dataset/mlit_20140919_2653/resource/ad0df3f7-8b7e-4540-8f85-355bbc3de43d", "https://data.e-gov.go.jp/data/api/3/action/package_show?id=mlit_20140919_2653", "https://hydrobharat.gov.in/?p=1821"]) {
  try { const [r, h] = await g(u); const links = [...new Set([...h.matchAll(/(?:href|src|action)="([^"]+)"/g)].map((m) => m[1]).filter((x) => /nav|warn|xml|rss|txt|csv|json|api|search|pdf|kaiho/i.test(x)))].slice(0, 25);
    console.log("PG " + r.status + " " + h.length + " " + r.url + " | " + links.join(" ") + " || " + txt(h).slice(0, 1500)); } catch (e) { console.log("PG ERR " + u + " " + e.message); }
}
