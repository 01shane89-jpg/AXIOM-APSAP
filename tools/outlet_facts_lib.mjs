// About this outlet: the pure parts (no files, no network), shared by tools/refresh_outlet_facts.mjs and tests/outlet_facts.test.mjs.
// Shane 2026-11-14: "add something that identifies why a media platform is reporting the way it is. Ie monetary purposes, political
// leaning etc" and then, on the decision card, "Facts on who owns and pays": owner, parent company, how it is funded and where it is
// based, from records anyone can check; a political leaning only where a public source states one, shown as "described as".
// Source: Wikidata (CC0), matched by the outlet's own web address (its "official website", P856). Every fact keeps the Wikidata item
// it came from, so a reader can open it. OSAP's own outlet list (tools/outlet_owners.json, tools/news_feeds.json state flag) wins for
// state media and public broadcasters. Nothing is OSAP's judgement of an outlet's reporting.
export const SCHEMA = "osap-outlet-facts/1";
export const P = { site: "P856", owner: "P127", parent: "P749", country: "P17", isa: "P31", form: "P1454", ideology: "P1142", income: "P2770", sponsor: "P859", founded: "P571" };

/** host of a link, without "www." and "m.", lower case; "" if none */
export function hostOf(u) {
  try { return new URL(String(u)).hostname.toLowerCase().replace(/^(www\d?|m|amp|mobile)\./, ""); } catch (e) { return ""; }
}
/** the official-website values a host may be stored as on Wikidata */
export function siteForms(host) {
  const out = [];
  for (const s of ["https://", "http://"]) for (const w of ["", "www."]) for (const t of ["/", ""]) out.push(s + w + host + t);
  return out;
}

/* How an outlet is paid for, from what its record says it is. Order matters: state before public before non-profit before business.
   The words are matched against the English labels of "instance of", "legal form", "source of income" and the owner's name. */
const RX = {
  state: /\b(state[- ]owned|state media|state[- ]run|government[- ]owned|government agency|state news agency|official newspaper|party newspaper|organ of the|propaganda)\b/i,
  stateOwner: /\b(government|ministry|state council|communist party|workers' party|state administration|presidential administration|council of ministers|armed forces|people's liberation army|federal agency|kingdom of|republic of)\b/i,
  public: /\b(public broadcast\w*|public[- ]service (broadcaster|media)|public radio|public television|public[- ]law|statutory corporation|license fee|licence fee)\b/i,
  nonprofit: /\b(non[- ]?profit|not[- ]for[- ]profit|charit\w*|foundation|trust|cooperative|co-operative|501\(c\)|association|donation\w*|membership)\b/i,
  business: /\b(company|business|enterprise|corporation|conglomerate|limited|llc|plc|gmbh|s\.a\.|public company|private company|joint[- ]stock|subsidiary|media group|holding|advertising|subscription\w*)\b/i,
};
export const FUNDING = {
  state: "Owned or run by a government or ruling party: its reporting is that government's line",
  public: "Public money (a licence fee or grant) under a public-service charter",
  nonprofit: "Non-profit: donations, grants or memberships",
  business: "A business: earns from advertising, subscriptions or sales, for its owners",
  unknown: "Not recorded",
};
/** kind of funding from the record's labels; osap: "state" | "public" | "" from OSAP's own outlet list (wins) */
export function fundingOf(rec, osap) {
  if (osap === "state" || osap === "public") return { kind: osap, why: "OSAP's outlet list" };
  const own = [...(rec.owner || []), ...(rec.parent || [])].map((x) => x.l).join("; ");
  const what = [...(rec.isa || []), ...(rec.form || []), ...(rec.income || [])].map((x) => x.l).join("; ");
  if (RX.state.test(what)) return { kind: "state", why: "Wikidata: " + pick(what, RX.state) };
  if (own && RX.stateOwner.test(own)) return { kind: "state", why: "Wikidata: owned by " + own };
  if (RX.public.test(what)) return { kind: "public", why: "Wikidata: " + pick(what, RX.public) };
  if (RX.nonprofit.test(what)) return { kind: "nonprofit", why: "Wikidata: " + pick(what, RX.nonprofit) };
  if (RX.business.test(what) || (own && RX.business.test(own))) return { kind: "business", why: "Wikidata: " + (pick(what, RX.business) || "owned by " + own) };
  if (own) return { kind: "business", why: "Wikidata: owned by " + own };
  return { kind: "unknown", why: "" };
}
function pick(s, rx) { return s.split("; ").find((x) => rx.test(x)) || ""; }

/** One outlet's facts from a Wikidata entity (wbgetentities JSON) and the labels of the items it names.
 *  Returns { q, n, cc?, own[], par[], isa[], fund{kind,why}, lean[], yr? } with each named item as [label, Q-id]. */
export function factsOf(ent, labels, ccOf, osap) {
  const claims = ent.claims || {};
  const ids = (p) => (claims[p] || []).filter((c) => c.mainsnak && c.mainsnak.datavalue && c.rank !== "deprecated" && !c.qualifiers?.P582)
    .map((c) => c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id).filter(Boolean);
  const lab = (q) => ({ q, l: labels.get(q) || "" });
  const rec = {
    owner: ids(P.owner).map(lab).filter((x) => x.l), parent: ids(P.parent).map(lab).filter((x) => x.l),
    isa: ids(P.isa).map(lab).filter((x) => x.l), form: ids(P.form).map(lab).filter((x) => x.l), income: ids(P.income).map(lab).filter((x) => x.l),
    ideology: ids(P.ideology).map(lab).filter((x) => x.l), country: ids(P.country),
  };
  const fund = fundingOf(rec, osap);
  const yr = ((claims[P.founded] || [])[0]?.mainsnak?.datavalue?.value?.time || "").match(/^[+-](\d{4})/);
  const cc = rec.country.map(ccOf).find(Boolean) || "";
  const two = (l) => l.slice(0, 4).map((x) => [x.l, x.q]);
  return {
    q: ent.id, n: (ent.labels && ent.labels.en && ent.labels.en.value) || (Object.values(ent.labels || {})[0] || {}).value || "",
    ...(cc ? { cc } : {}), own: two(rec.owner), par: two(rec.parent), isa: two(rec.isa), fund,
    // a political leaning only as the record states it ("political ideology"), never OSAP's rating
    lean: two(rec.ideology), ...(yr ? { yr: +yr[1] } : {}),
  };
}
