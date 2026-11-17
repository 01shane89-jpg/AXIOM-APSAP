// Open-licence full text (Shane 17 Nov 2026, decision card: "Free-to-reuse sources only").
// OSAP never copies an outlet's article text (tools/outlet_text.mjs). The one exception is a publisher whose own licence lets
// anyone republish its text, commercial use included, with credit. Those publishers are listed in RULES below, each with the
// licence, where the licence is stated, and what it asks. Nothing else is fetched, and nothing here goes past a refusal: a
// page that answers 401/403/429 or a bot check is left as a link (no other user agent, no proxy, no retry past the block).
//
// Each article is stored as the publisher wrote it: text only, unedited (CC BY-ND forbids edits and translations), images
// left out (their licences differ), with the authors and their institutions, the licence, the time OSAP read the page and the
// SHA-256 of the page bytes OSAP read, so the copy can be checked against the source. Extraction is plain rules, not AI.
// Pure functions here; tools/refresh_fulltext.mjs fetches and writes data/live/fulltext/<shard>.js.

export const EXTRACTOR = "fulltext v1";
export const SHARDS = 64;

// Publishers whose licence allows commercial republishing with credit. host: exact host names (www. optional).
// refetchDays: pages that change (travel advice) are read again after that many days; articles are read once.
export const RULES = [
  {
    id: "conversation", hosts: ["theconversation.com"], name: "The Conversation",
    lic: "CC BY-ND 4.0", licUrl: "https://creativecommons.org/licenses/by-nd/4.0/",
    terms: "https://theconversation.com/global/republishing-guidelines",
    note: "Republished unedited under the publisher's Creative Commons licence, crediting the authors, their institutions and The Conversation. Images are left out (their licences differ). No translation: a translation is a derivative the licence does not allow.",
    nd: true, path: /^\/[a-z0-9-]+-\d+\/?$/i, refetchDays: 0
  },
  {
    id: "govuk", hosts: ["www.gov.uk"], name: "GOV.UK",
    lic: "Open Government Licence v3.0", licUrl: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
    terms: "https://www.gov.uk/help/terms-conditions",
    note: "Crown copyright, reused under the Open Government Licence v3.0. Contains public sector information licensed under the Open Government Licence v3.0.",
    nd: false, path: /^\/(foreign-travel-advice\/[a-z-]+|government\/(news|speeches)\/[a-z0-9-]+)\/?$/i, refetchDays: 3,
    // GOV.UK's own Content API gives the whole guide (every part of a travel advice page) as published, under the same licence
    api: (u) => "https://www.gov.uk/api/content" + new URL(u).pathname.replace(/\/$/, ""), apiName: "GOV.UK Content API"
  }
];

export function ruleFor(url) {
  let u; try { u = new URL(String(url)); } catch (e) { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  const host = u.hostname.toLowerCase();
  return RULES.find((r) => r.hosts.some((h) => h === host || "www." + h === host) && r.path.test(u.pathname)) || null;
}

// FNV-1a over the address: the same shard in the browser (assets/osap-reader.js) without crypto.subtle
export function fnv(s) {
  let h = 0x811c9dc5; s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export const shardOf = (url) => (fnv(url) % SHARDS).toString(16).padStart(2, "0");

// ---------- HTML to text, without running anything on the page ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  hellip: "…", bull: "•", middot: "·", eacute: "é", egrave: "è", aacute: "á", oacute: "ó", uacute: "ú", iacute: "í", ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä", ccedil: "ç", deg: "°", pound: "£", euro: "€", copy: "©", reg: "®", trade: "™", times: "×" };
export function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : ""; }
    return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
  });
}
const clean = (s) => decode(String(s).replace(/<[^>]*>/g, "")).replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b\u2028\u2029]/g, "").replace(/\s+/g, " ").trim();

// the inner HTML of the element whose opening tag starts at `at`, matched by counting that tag name's opens and closes
export function innerAt(html, at) {
  const open = html.slice(at).match(/^<([a-z][a-z0-9]*)\b[^>]*>/i); if (!open) return "";
  const tag = open[1].toLowerCase(), re = new RegExp("<(/?)" + tag + "\\b[^>]*>", "gi");
  re.lastIndex = at + open[0].length;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    if (/\/>$/.test(m[0])) continue;
    depth += m[1] ? -1 : 1;
    if (!depth) return html.slice(at + open[0].length, m.index);
  }
  return "";
}

// blocks of text: headings, paragraphs, list items, quotes. A block is { k: "h"|"hs"|"p"|"li"|"q", s: [part, ...] } where a part is
// plain text or [text, https link]. Scripts, styles, forms, figures, pictures, embeds, asides and navigation are dropped.
const DROP = /<(script|style|noscript|template|form|figure|picture|svg|iframe|object|video|audio|aside|nav|button|select|textarea|header|footer)\b[\s\S]*?<\/\1\s*>/gi;
export function blocks(html, base) {
  const out = [];
  let h = String(html).replace(/<!--[\s\S]*?-->/g, "").replace(DROP, " ").replace(/<(img|input|source|embed|link|meta)\b[^>]*>/gi, " ");
  const re = /<(h[1-6]|p|li|blockquote|dt|dd|td)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let m;
  while ((m = re.exec(h))) {
    const tag = m[1].toLowerCase(), inner = m[2];
    if (tag !== "li" && /<(p|li|h[1-6])\b/i.test(inner)) { re.lastIndex = m.index + m[0].indexOf(">") + 1; continue; }
    const parts = [], lr = /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi;
    let last = 0, a;
    while ((a = lr.exec(inner))) {
      const before = clean(inner.slice(last, a.index).replace(/<br\s*\/?>/gi, " "));
      if (before) parts.push(before);
      const txt = clean(a[2]); let link = "";
      try { const u = new URL(decode(a[1]), base); if (u.protocol === "https:" && !u.username && !u.password) link = u.href; } catch (e) {}
      if (txt) parts.push(link ? [txt, link] : txt);
      last = a.index + a[0].length;
    }
    const tail = clean(inner.slice(last).replace(/<br\s*\/?>/gi, " "));
    if (tail) parts.push(tail);
    const text = parts.map((p) => (typeof p === "string" ? p : p[0])).join(" ");
    if (!text.trim()) continue;
    // spacing: a link and the text either side were cut apart; put single spaces back except before punctuation
    const s = [];
    parts.forEach((p, i) => { if (i && !/^[.,;:!?)\]’”]/.test(typeof p === "string" ? p : p[0])) s.push(" "); s.push(p); });
    out.push({ k: /^h[12]$/.test(tag) ? "h" : /^h/.test(tag) ? "hs" : tag === "li" ? "li" : tag === "blockquote" ? "q" : "p", s: merge(s) });
  }
  return out;
}
function merge(s) { const o = []; s.forEach((p) => { if (typeof p === "string" && typeof o[o.length - 1] === "string") o[o.length - 1] += p; else o.push(p); }); return o; }

function meta(html, name) {
  const m = html.match(new RegExp('<meta[^>]+(?:name|property)=["\']' + name + '["\'][^>]*content=["\']([^"\']*)["\']', "i")) ||
    html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:name|property)=["\']' + name + '["\']', "i"));
  return m ? clean(m[1]) : "";
}

// the article from a publisher's page: { title, by: [{ n, r }], pub, mod, blocks, chars } or { why } when it cannot be read
export function extract(rule, html, url) {
  html = String(html || "");
  if (/_Incapsula_Resource|cf-chl-|challenge-platform|captcha/i.test(html) && html.length < 20000) return { why: "bot check" };
  const title = meta(html, "og:title") || clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  let body = "", by = [], pub = "", mod = "";
  if (rule.id === "conversation") {
    const at = html.search(/<div[^>]+itemprop=["']articleBody["']/i);
    body = at >= 0 ? innerAt(html, at) : "";
    // every author with their role and institution, as the byline shows them
    const ar = /<span[^>]*class=["'][^"']*\bauthor-name\b[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]{0,400}?<p[^>]*class=["']role["'][^>]*>([\s\S]*?)<\/p>/gi; let m;
    const seen = {};
    while ((m = ar.exec(html))) { const n = clean(m[1]); if (n && !seen[n]) { seen[n] = 1; by.push({ n, r: clean(m[2]) }); } }
    if (!by.length && meta(html, "author")) by.push({ n: meta(html, "author"), r: meta(html, "institution") });
    pub = meta(html, "article:published_time"); mod = meta(html, "article:modified_time");
    const t = (html.match(/<time[^>]+datetime=["']([^"']+)["']/i) || [])[1]; if (!pub && t) pub = t;
  } else if (rule.id === "govuk") {
    // the Content API answer (JSON): a guide's parts in order, each under its own heading, or a news item's body
    let d = null; try { d = JSON.parse(html); } catch (e) { return { why: "not a Content API answer" }; }
    const de = (d && d.details) || {};
    if (Array.isArray(de.parts) && de.parts.length) body = de.parts.map((p) => "<h2>" + String(p.title || "").replace(/</g, "&lt;") + "</h2>" + String(p.body || "")).join("");
    else if (typeof de.body === "string") body = de.body;
    const orgs = (d.links && d.links.organisations) || [];
    orgs.slice(0, 3).forEach((o) => { if (o && o.title) by.push({ n: clean(o.title), r: "" }); });
    pub = d.first_published_at || ""; mod = d.public_updated_at || "";
    return finish(clean(d.title || ""), by, pub, mod, body, url, de.change_description ? clean(de.change_description) : "");
  }
  return finish(title, by, pub, mod, body, url, "");
}
function finish(title, by, pub, mod, body, url, change) {
  const B = body ? blocks(body, url) : [];
  const chars = B.reduce((n, b) => n + b.s.reduce((k, p) => k + (typeof p === "string" ? p : p[0]).length, 0), 0);
  if (chars < 200) return { why: body ? "too little text" : "no article found" };
  const o = { title, by, pub: String(pub).slice(0, 25), mod: String(mod).slice(0, 25), blocks: B.slice(0, 600), chars };
  if (change) o.change = change.slice(0, 300);
  return o;
}

// the shard file as the browser reads it
export function shardJs(key, entries) {
  return "window.OSAP_FT=window.OSAP_FT||{};window.OSAP_FT[" + JSON.stringify(key) + "]=" + JSON.stringify(entries).replace(/<\//g, "<\\/").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029") + ";\n";
}
