/* AXIOM OSAP: report builder core (Shane 2026-11-18, thread "Design the OSAP report builder": "The formatting and
   quality/completeness needs to be unmatched. Including product rules like north seeking arrow, map scale, legend, source
   referencing per item"). Pure functions, no page access, so the same rules run in the browser and in tests/rb_core.test.mjs.
   What lives here:
   - the product model: one product (a SITREP for now) is the analyst's own draft built from clips held in the report sandbox.
     A clip is a reference, never evidence: a map snip keeps the drawn area, the base map and, per mark, the source's title,
     link, publisher, publish time, capture time, claim status and SHA-256 record fingerprint, so it can be re-rendered later and
     every item stays traceable. Nothing here changes a record, a claim status or a grade.
   - the product QC check: fixed rules (no AI) that an export must pass. A "block" stops the export unless the analyst gives a
     reason to override it; a "warn" must be acknowledged. Both are written into the release record and the printed QC annex.
   - analytic standards: ICD 203-style likelihood words and confidence levels, kept as separate fields, so a judgment always says
     how likely and how sure, and the two never blur.
   - release: each export is a numbered version with who, when, the QC result, any override reason and a SHA-256 over the
     product's canonical content (a decision record; the store is the analyst's browser, so it is attributable, not tamper-proof).
   - AI authority: every text block carries its origin. Text whose origin is "ai" must be approved by the analyst before release;
     the QC check blocks it otherwise. (AI drafting itself is a later milestone; the rule is in place first.)
   window.OSAP_RB_CORE (browser) or module.exports (Node). */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OSAP_RB_CORE = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var SCHEMA = "osap-rb/1";

  /* ICD 203 expressions of likelihood, with their ranges */
  var LIKELIHOOD = [
    ["almost-no-chance", "Almost no chance", "01-05%"],
    ["very-unlikely", "Very unlikely", "05-20%"],
    ["unlikely", "Unlikely", "20-45%"],
    ["even-chance", "Roughly even chance", "45-55%"],
    ["likely", "Likely", "55-80%"],
    ["very-likely", "Very likely", "80-95%"],
    ["almost-certain", "Almost certain", "95-99%"]
  ];
  var CONFIDENCE = [
    ["low", "Low confidence", "Sources are few, fragmentary, of doubtful reliability, or the judgment rests heavily on assumptions"],
    ["moderate", "Moderate confidence", "Credibly sourced and plausible, but not corroborated well enough for high confidence"],
    ["high", "High confidence", "Based on high-quality information from several sources, or the nature of the issue allows a solid judgment"]
  ];
  /* words that hedge without saying how likely; a key judgment should use the standard terms instead */
  var VAGUE = /\b(may|might|could|possibly|perhaps|potentially|appears? to|seems? to)\b/i;
  var LIK_WORDS = /\b(almost no chance|very unlikely|unlikely|roughly even chance|even chance|likely|very likely|almost certain(ly)?|probabl[ey]|improbabl[ey]|remote(ly)?|highly likely|highly unlikely)\b/gi;
  var SRC_TYPES = [
    ["official", "Official (government or military statement: a claim)"],
    ["media", "News media"],
    ["state-media", "State media"],
    ["wire", "Wire service"],
    ["independent", "Independent or research"],
    ["social", "Social media (unverified)"],
    ["open-data", "Open data"],
    ["sensor", "Instrument or sensor reading"],
    ["other", "Other"]
  ];
  var TEMPLATES = {
    sitrep: { name: "SITREP", long: "Situation report", code: "SR",
      sections: [["bluf", "Bottom line up front"], ["situation", "Situation"], ["kj", "Key judgments"], ["figs", "Maps and figures"],
        ["stats", "Data statistics"], ["gaps", "Intelligence gaps"], ["outlook", "Outlook and indicators to watch"], ["sources", "Sources"]] }
  };
  var LIMITS = { bluf: 700, situation: 6000, block: 4000, kj: 600, title: 140, kjs: 12, figs: 12, sources: 60, crowded: 120, staleH: 24, snipItems: 300 };

  function lik(k) { for (var i = 0; i < LIKELIHOOD.length; i++) if (LIKELIHOOD[i][0] === k) return LIKELIHOOD[i]; return null; }
  function conf(k) { for (var i = 0; i < CONFIDENCE.length; i++) if (CONFIDENCE[i][0] === k) return CONFIDENCE[i]; return null; }
  function srcType(k) { for (var i = 0; i < SRC_TYPES.length; i++) if (SRC_TYPES[i][0] === k) return SRC_TYPES[i]; return null; }
  function str(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, n || 4000); }
  function safeUrl(u) { u = String(u || ""); return /^https?:\/\/[^\s"<>]+$/i.test(u) ? u : ""; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  var MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  /* military date-time group in Zulu: 180106Z NOV 26 */
  function dtg(ms) {
    if (!isFinite(ms) || ms == null) return "";
    var d = new Date(+ms);
    return pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + "Z " + MON[d.getUTCMonth()] + " " + String(d.getUTCFullYear()).slice(2);
  }
  function ymd(ms) { var d = new Date(+ms); return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()); }

  /* canonical JSON: keys sorted, so the same content always hashes the same */
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  }

  /* ---------- store ---------- */
  function emptyStore() { return { schema: SCHEMA, clips: [], products: [] }; }
  function normStore(s) {
    if (!s || typeof s !== "object" || s.schema !== SCHEMA) return emptyStore();
    if (!Array.isArray(s.clips)) s.clips = [];
    if (!Array.isArray(s.products)) s.products = [];
    s.clips = s.clips.filter(function (c) { return c && typeof c.id === "string" && (c.kind === "snip" || c.kind === "source"); });
    s.products = s.products.filter(function (p) { return p && typeof p.id === "string" && TEMPLATES[p.tpl]; });
    return s;
  }

  /* ---------- products ---------- */
  function nextNo(store, tpl, now) {
    var pre = "OSAP-" + TEMPLATES[tpl].code + "-" + ymd(now) + "-", n = 0;
    store.products.forEach(function (p) { if (p.no && p.no.indexOf(pre) === 0) n = Math.max(n, +p.no.slice(pre.length) || 0); });
    return pre + pad(n + 1);
  }
  function block(text, origin) { return { text: str(text), origin: origin === "ai" ? "ai" : "analyst", approved: origin !== "ai" }; }
  function newProduct(store, tpl, opts, now) {
    opts = opts || {}; tpl = TEMPLATES[tpl] ? tpl : "sitrep";
    var p = { id: opts.id || "p" + now.toString(36), tpl: tpl, no: nextNo(store, tpl, now), title: str(opts.title, LIMITS.title),
      handling: str(opts.handling || "UNCLASSIFIED // OPEN SOURCE. Built from publicly available information; not an official government product.", 300),
      aoi: str(opts.aoi, 200), author: str(opts.author, 60), asOf: now, created: now, updated: now,
      blocks: { bluf: block(""), situation: block(""), gaps: block(""), outlook: block("") },
      kjs: [], figs: [], srcs: [], releases: [] };
    return p;
  }
  function newKj(now) { return { id: "k" + now.toString(36) + Math.floor(Math.random() * 1e4).toString(36), text: "", lik: "", conf: "", origin: "analyst", approved: true }; }

  /* ---------- snips: a clip of the map. spec is data; the picture is drawn from it whenever it is shown ---------- */
  function statusOf(it) {
    if (it.kind === "open") return "Open data";
    if (it.kind === "social") return "Social media post, unverified";
    if (it.obj) return "Map object, as listed by its source";
    if (it.status === "Observed") return "Observed, not reviewed";
    if (it.claim) return "Official statement: a claim, not confirmed";
    return "Reported, not verified";
  }
  function typeOf(it) {
    if (it.kind === "open") return "open-data";
    if (it.kind === "social") return "social";
    if (it.status === "Observed") return "sensor";
    if (it.claim) return "official";
    if (it.obj) return "other";
    return "media";
  }
  /* items: from the area report's collect(): incidents I, other reports R, map objects M, each with its fingerprint (fp) */
  function makeSnip(input, now) {
    var items = (input.items || []).slice(0, LIMITS.snipItems).map(function (it) {
      return { no: str(it.no, 8), title: str(it.title, 300), url: safeUrl(it.url), src: str(it.src, 120), pub: it.t && isFinite(it.t) ? +it.t : null,
        when: str(it.when, 60), status: statusOf(it), stype: typeOf(it), layer: str(it.layer || it.group, 80), fp: /^[0-9a-f]{16,64}$/.test(it.fp || "") ? it.fp : "",
        lat: it.lat != null && isFinite(it.lat) ? +(+it.lat).toFixed(5) : null, lon: it.lon != null && isFinite(it.lon) ? +(+it.lon).toFixed(5) : null };
    });
    var marks = (input.marks || []).filter(function (m) { return m && isFinite(m.lat) && isFinite(m.lon); }).slice(0, 1500).map(function (m) {
      return { lat: +(+m.lat).toFixed(5), lon: +(+m.lon).toFixed(5), sym: str(m.sym, 40), no: str(m.no, 8), kind: str(m.kind, 20) };
    });
    var newest = items.reduce(function (x, it) { return Math.max(x, it.pub || 0); }, 0);
    return { id: input.id || "c" + now.toString(36), kind: "snip", v: 1, captured: now, dataAsOf: newest || null,
      P: (input.P || []).map(function (p) { return [+(+p[0]).toFixed(6), +(+p[1]).toFixed(6)]; }), base: str(input.base, 20), baseAttr: str(input.baseAttr, 300),
      cc: str(input.cc, 8), country: str(input.country, 80), period: str(input.period, 80), caption: str(input.caption, 400),
      legend: (input.legend || []).map(function (k) { return str(k, 40); }), dots: !!input.dots, dropped: Math.max(0, +input.dropped || 0),
      marks: marks, items: items, supersedes: input.supersedes || null, digest: "" };
  }
  /* what the snip's digest covers: everything but the digest itself and the analyst's caption (which they may edit) */
  function snipDigestInput(s) {
    var o = {}; Object.keys(s).forEach(function (k) { if (k !== "digest" && k !== "caption") o[k] = s[k]; });
    return canon(o);
  }

  /* ---------- sources: numbered references ---------- */
  /* standalone sources are S1..Sn; items in figure n are Fn.I3, Fn.R2, Fn.M1 */
  function refMap(p, clipsById) {
    var m = {};
    (p.srcs || []).forEach(function (s, i) { m["S" + (i + 1)] = { kind: "src", s: s }; });
    (p.figs || []).forEach(function (f, i) {
      var c = clipsById[f.clip]; if (!c) return;
      m["F" + (i + 1)] = { kind: "fig", c: c };
      c.items.forEach(function (it) { m["F" + (i + 1) + "." + it.no] = { kind: "item", it: it, c: c }; });
    });
    return m;
  }
  var CITE_RE = /\[((?:S\d{1,3}|F\d{1,2}(?:\.[IRM]\d{1,4})?)(?:\s*[,;]\s*(?:S\d{1,3}|F\d{1,2}(?:\.[IRM]\d{1,4})?))*)\]/g;
  function cites(text) {
    var out = []; String(text || "").replace(CITE_RE, function (m, g) { g.split(/\s*[,;]\s*/).forEach(function (r) { out.push(r); }); return m; });
    return out;
  }

  /* ---------- data statistics: fixed counts over everything the product cites from (Shane 2026-11-18: "having data
     statistics is always good too"). Items shown on more than one figure count once (same SHA-256, else same link and title). */
  function stats(p, clipsById) {
    var seen = {}, rows = [];
    (p.figs || []).forEach(function (f) { var c = clipsById[f.clip]; if (c) c.items.forEach(function (it) { rows.push(it); }); });
    (p.srcs || []).forEach(function (s) { rows.push({ title: s.title, url: s.url, src: s.src, pub: s.pub, stype: s.stype || "", fp: s.fp, lat: null, standalone: 1 }); });
    rows = rows.filter(function (it) { var k = it.fp || (it.url + "|" + it.title); if (seen[k]) return false; seen[k] = 1; return true; });
    var byType = {}, bySrc = {}, days = {}, mapped = 0, linked = 0, t0 = 0, t1 = 0;
    rows.forEach(function (it) {
      var ty = it.stype || "other"; byType[ty] = (byType[ty] || 0) + 1;
      var sn = String(it.src || "").trim() || (/^https?:\/\/([^\/?#]+)/i.exec(it.url || "") || [])[1] || "Not stated"; sn = sn.replace(/^www\./, "");
      bySrc[sn] = (bySrc[sn] || 0) + 1;
      if (it.lat != null) mapped++;
      if (safeUrl(it.url)) linked++;
      if (it.pub) { t0 = t0 ? Math.min(t0, it.pub) : it.pub; t1 = Math.max(t1, it.pub); var d = new Date(it.pub).toISOString().slice(0, 10); days[d] = (days[d] || 0) + 1; }
    });
    var srcs = Object.keys(bySrc).map(function (k) { return [k, bySrc[k]]; }).sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); });
    var types = SRC_TYPES.map(function (t) { return [t[0], t[1], byType[t[0]] || 0]; }).filter(function (t) { return t[2]; });
    /* the last 14 days that hold items, ending at the newest */
    var dayList = [];
    if (t1) for (var i = 13; i >= 0; i--) { var dd = new Date(Date.parse(new Date(t1).toISOString().slice(0, 10)) - i * 864e5).toISOString().slice(0, 10); dayList.push([dd, days[dd] || 0]); }
    var top = srcs.length ? srcs[0][1] / rows.length : 0;
    return { n: rows.length, sources: srcs.length, top: srcs.slice(0, 8), types: types, mapped: mapped, linked: linked, dated: Object.keys(days).reduce(function (x, d) { return x + days[d]; }, 0),
      from: t0 || null, to: t1 || null, days: dayList, topShare: top, official: byType.official || 0, state: byType["state-media"] || 0, social: byType.social || 0 };
  }

  /* ---------- the product QC check ---------- */
  function qc(p, clipsById, now) {
    var out = [], T = TEMPLATES[p.tpl] || TEMPLATES.sitrep, refs = refMap(p, clipsById), used = {};
    function add(sev, id, where, msg) { out.push({ sev: sev, id: id, where: where, msg: msg }); }
    function trim(s) { return String(s || "").trim(); }
    function sentences(s) { return trim(s) ? trim(s).split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/).length : 0; }
    function checkCites(text, where) {
      cites(text).forEach(function (r) { used[r] = 1; if (/^F\d+\./.test(r)) used[r.split(".")[0]] = 1; if (!refs[r]) add("block", "S1", where, "Citation [" + r + "] does not match any source or figure item in this product."); });
    }
    /* header */
    if (!trim(p.title)) add("block", "H1", "Header", "Give the product a title.");
    if (!/^OSAP-[A-Z]{2}-\d{8}-\d{2,}$/.test(p.no || "")) add("block", "H2", "Header", "The product number is missing or malformed.");
    if (!isFinite(p.asOf) || !p.asOf) add("block", "H3", "Header", "Set the as-of date-time group.");
    else if (p.asOf > now + 5 * 60e3) add("block", "H3", "Header", "The as-of time is in the future.");
    if (!trim(p.handling)) add("block", "H4", "Header", "Add the handling line.");
    if (!trim(p.aoi)) add("warn", "H5", "Header", "Name the area or country of interest.");
    if (!trim(p.author)) add("warn", "H6", "Header", "Add the author or call sign, so readers know whose judgments these are.");
    /* bottom line */
    var b = p.blocks || {}, bl = trim(b.bluf && b.bluf.text);
    if (!bl) add("block", "A1", T.sections[0][1], "Write the bottom line up front: what happened, why it matters, what comes next.");
    else {
      if (bl.length > LIMITS.bluf || sentences(bl) > 4) add("warn", "A2", T.sections[0][1], "The BLUF runs " + sentences(bl) + " sentences and " + bl.length + " characters; keep it to 4 sentences and " + LIMITS.bluf + " characters.");
      if (!cites(bl).length) add("warn", "A3", T.sections[0][1], "The BLUF cites no source. Add [S1] or [F1.I2] style references.");
      checkCites(bl, T.sections[0][1]);
    }
    /* situation: figures need sources */
    var sit = trim(b.situation && b.situation.text);
    if (!sit) add("warn", "A10", "Situation", "The situation section is empty.");
    else {
      if (sit.length > LIMITS.situation) add("warn", "L2", "Situation", "The situation runs " + sit.length + " characters; a SITREP should read in two minutes.");
      sit.split(/\n\s*\n|\n/).forEach(function (para, i) {
        if (/\b\d[\d,.]*\s*(killed|dead|injured|wounded|missing|displaced|arrested|people|troops|soldiers|civilians|%|percent|aircraft|vessels|drones|missiles|rockets)\b/i.test(para) && !cites(para).length)
          add("warn", "S5", "Situation, paragraph " + (i + 1), "A figure without a citation. Say whose figure it is: government figures are claims.");
      });
      checkCites(sit, "Situation");
    }
    /* key judgments */
    var kjs = p.kjs || [];
    if (!kjs.length) add("block", "A4", "Key judgments", "Add at least one key judgment.");
    if (kjs.length > LIMITS.kjs) add("warn", "A4", "Key judgments", "More than " + LIMITS.kjs + " key judgments; keep the ones that change a decision.");
    kjs.forEach(function (k, i) {
      var w = "Key judgment " + (i + 1), t = trim(k.text);
      if (!t) { add("block", "A5", w, "The judgment is empty."); return; }
      if (!lik(k.lik)) add("block", "A5", w, "Pick a likelihood word (ICD 203 scale).");
      if (!conf(k.conf)) add("block", "A5", w, "Pick a confidence level: low, moderate or high.");
      if (!cites(t).length) add("block", "A5", w, "Cite the sources the judgment rests on.");
      var said = (t.match(LIK_WORDS) || []).map(function (x) { return x.toLowerCase(); });
      var picked = lik(k.lik) ? lik(k.lik)[1].toLowerCase() : "";
      var clash = said.filter(function (x) { return picked && !new RegExp("(^|\\s)" + x + "$").test(picked); });
      if (clash.length) add("warn", "A6", w, "The text says \"" + clash[0] + "\" but the likelihood picked is \"" + lik(k.lik)[1] + "\". Use one.");
      if (VAGUE.test(t)) add("warn", "A6", w, "\"" + t.match(VAGUE)[0] + "\" hedges without saying how likely. The likelihood word does that job.");
      if (t.length > LIMITS.kj) add("warn", "A7", w, "Long judgment (" + t.length + " characters). State it, then support it in the situation.");
      checkCites(t, w);
    });
    if (!trim(b.gaps && b.gaps.text)) add("warn", "A8", "Intelligence gaps", "Say what is not known and what would change the judgments.");
    else checkCites(b.gaps.text, "Intelligence gaps");
    if (!trim(b.outlook && b.outlook.text)) add("warn", "A9", "Outlook", "Name the indicators to watch.");
    else checkCites(b.outlook.text, "Outlook");
    /* AI authority: no AI text leaves unapproved */
    Object.keys(b).forEach(function (k) { if (b[k] && b[k].origin === "ai" && !b[k].approved && trim(b[k].text)) add("block", "A11", k, "AI-drafted text not yet approved by the analyst."); });
    kjs.forEach(function (k, i) { if (k.origin === "ai" && !k.approved) add("block", "A11", "Key judgment " + (i + 1), "AI-drafted judgment not yet approved by the analyst."); });
    /* figures */
    var figs = p.figs || [];
    if (figs.length > LIMITS.figs) add("warn", "F7", "Maps and figures", "More than " + LIMITS.figs + " figures.");
    figs.forEach(function (f, i) {
      var w = "Figure " + (i + 1), c = clipsById[f.clip];
      if (!c) { add("block", "F0", w, "The snip this figure shows is no longer in the sandbox."); return; }
      if (!trim(f.caption || c.caption)) add("block", "F1", w, "Write a caption: what the map shows and why it is here.");
      if (!c.P || c.P.length < 3) add("block", "F1", w, "The snip has no area.");
      if (!trim(c.baseAttr)) add("block", "F2", w, "Base map credit missing.");
      if (!c.captured) add("block", "F3", w, "Capture time missing.");
      /* the legend must list exactly the symbols on the map */
      var shown = {}; c.marks.forEach(function (m) { if (m.sym) shown[m.sym] = 1; });
      var extra = (c.legend || []).filter(function (k) { return !shown[k]; }), missing = Object.keys(shown).filter(function (k) { return (c.legend || []).indexOf(k) < 0; });
      if (extra.length) add("block", "F4", w, "The legend lists symbols the map does not show (" + extra.join(", ") + "). Re-render the snip.");
      if (missing.length) add("block", "F4", w, "Symbols on the map are missing from the legend (" + missing.join(", ") + "). Re-render the snip.");
      if (c.marks.length > LIMITS.crowded) add("warn", "F5", w, c.marks.length + " marks: the map will be hard to read. Snip a smaller area or a shorter period.");
      if (c.dropped) add("warn", "F5", w, c.dropped + " items inside the area did not fit on this snip (" + LIMITS.snipItems + " at most). Snip a smaller area or a shorter period.");
      if (!c.marks.length) add("warn", "F6", w, "The map shows no marks.");
      if (p.asOf && c.captured && p.asOf - c.captured > LIMITS.staleH * 3600e3) add("warn", "F8", w, "Snipped " + Math.round((p.asOf - c.captured) / 3600e3) + " h before the product's as-of time. Re-render it to bring it up to date.");
      var noFp = c.items.filter(function (it) { return !it.fp; }).length;
      if (noFp) add("warn", "S3", w, noFp + " item" + (noFp === 1 ? "" : "s") + " without a SHA-256 fingerprint.");
      var noLink = c.items.filter(function (it) { return !it.url; }).length;
      if (noLink) add("warn", "S3", w, noLink + " item" + (noLink === 1 ? "" : "s") + " without a source link (listed as such).");
      if (!c.digest) add("warn", "S3", w, "The snip has no SHA-256 digest (this browser could not compute one).");
    });
    /* standalone sources */
    (p.srcs || []).forEach(function (s, i) {
      var w = "Source S" + (i + 1);
      if (!trim(s.title)) add("block", "S2", w, "Source title missing.");
      if (!safeUrl(s.url) && !trim(s.nolink)) add("warn", "S3", w, "No link. Say where the source can be found.");
      if (!srcType(s.stype)) add("warn", "S4", w, "Mark the source type (official, media, state media, wire, independent, social, open data, sensor).");
      if (!s.pub) add("warn", "S3", w, "Publish time unknown.");
      if (!s.fp) add("warn", "S3", w, "No SHA-256 fingerprint.");
      if (!used["S" + (i + 1)]) add("warn", "S6", w, "Listed but never cited.");
    });
    /* data balance: a product that leans on one source, or mostly on official claims, says so */
    var st = stats(p, clipsById);
    if (st.n >= 5 && st.topShare > 0.5) add("warn", "D1", "Data statistics", Math.round(st.topShare * 100) + "% of the items come from one source (" + st.top[0][0] + "). Say so in the judgments, or add independent sources.");
    if (st.n >= 5 && (st.official + st.state) / st.n > 0.5) add("warn", "D2", "Data statistics", "Most items are official or state-media claims (" + (st.official + st.state) + " of " + st.n + "). Treat the picture as the government's account.");
    figs.forEach(function (f, i) { if (!used["F" + (i + 1)]) add("warn", "F9", "Figure " + (i + 1), "Not referred to in the text. Cite [F" + (i + 1) + "] or an item on it."); });
    return out;
  }
  function qcSummary(list) {
    var b = list.filter(function (x) { return x.sev === "block"; }).length, w = list.length - b;
    return { blocks: b, warns: w, pass: b === 0 };
  }

  /* ---------- release ---------- */
  /* what a release's digest covers: the product content and the digests of the snips it shows */
  function releaseInput(p, clipsById) {
    var o = { tpl: p.tpl, no: p.no, title: p.title, handling: p.handling, aoi: p.aoi, author: p.author, asOf: p.asOf,
      blocks: p.blocks, kjs: p.kjs, srcs: p.srcs,
      figs: (p.figs || []).map(function (f) { var c = clipsById[f.clip]; return { caption: f.caption || (c && c.caption) || "", snip: c ? c.digest || snipDigestInput(c) : "" }; }) };
    return canon(o);
  }
  /* returns the release record, or { error } when the QC check blocks and no override reason is given */
  function release(p, clipsById, opts, now) {
    opts = opts || {};
    var list = qc(p, clipsById, now), s = qcSummary(list), reason = String(opts.override || "").trim();
    /* unapproved AI text is never released, override or not: the analyst approves it or deletes it */
    if (list.some(function (x) { return x.id === "A11"; })) return { error: "ai-unapproved", qc: list };
    if (!s.pass && reason.length < 10) return { error: "blocked", qc: list };
    if (s.warns && !opts.ackWarnings) return { error: "unacknowledged", qc: list };
    var v = (p.releases || []).reduce(function (x, r) { return Math.max(x, r.v || 0); }, 0) + 1;
    return { rec: { v: v, at: now, by: str(opts.actor || p.author || "", 60), digest: opts.digest || "", blocks: s.blocks, warns: s.warns,
      override: s.pass ? null : reason.slice(0, 400), findings: list.map(function (x) { return x.sev + " " + x.id + " " + x.where + ": " + x.msg; }).slice(0, 80) }, qc: list };
  }

  return { SCHEMA: SCHEMA, LIKELIHOOD: LIKELIHOOD, CONFIDENCE: CONFIDENCE, SRC_TYPES: SRC_TYPES, TEMPLATES: TEMPLATES, LIMITS: LIMITS,
    lik: lik, conf: conf, srcType: srcType, dtg: dtg, canon: canon, safeUrl: safeUrl, emptyStore: emptyStore, normStore: normStore,
    newProduct: newProduct, newKj: newKj, block: block, makeSnip: makeSnip, snipDigestInput: snipDigestInput, refMap: refMap, cites: cites,
    qc: qc, qcSummary: qcSummary, stats: stats, releaseInput: releaseInput, release: release };
});
