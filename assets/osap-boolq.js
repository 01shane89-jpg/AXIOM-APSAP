/* OSAP Boolean watch words (window.OSAP_BOOLQ; also require()-able so tools/push_lib.mjs checks a push watch with the same parser).
   A watch's Words box takes either the old comma list ("ferry, landslide, Hat Yai": any one of them) or a Boolean string:
     AND, OR, NOT (capitals), "exact phrase", ( ), a leading - for NOT, | for OR, & for AND; commas also mean OR;
     words side by side mean AND. Every word or phrase matches at the start of a word, as watch words always have, so
     bomb also finds bombing, and a trailing * changes nothing.
   Also here: the ready-made quick searches, and draft(), which turns a plain description into a Boolean string with fixed word
   rules. draft() is not a language model: GitHub Models does not answer from the refresh runners (see tools/daily_lib.mjs), and
   OSAP has no keys, so the draft is rules-built and labelled "Auto-drafted"; the user edits it before saving. */
(function (root) {
  "use strict";
  var MAX_LEN = 600, MAX_TERMS = 40, MAX_DEPTH = 8;

  /* ---------- parse ---------- */
  function tokens(s) {
    var out = [], i = 0, n = s.length;
    while (i < n) {
      var c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "(" || c === ")") { out.push({ t: c }); i++; continue; }
      if (c === "," || c === "|") { out.push({ t: "OR" }); i++; continue; }
      if (c === "&") { out.push({ t: "AND" }); i++; continue; }
      if (c === '"' || c === "“" || c === "”") {
        var j = i + 1; while (j < n && s[j] !== '"' && s[j] !== "“" && s[j] !== "”") j++;
        if (j >= n) throw new Error("a quote is not closed");
        var ph = s.slice(i + 1, j).replace(/\s+/g, " ").trim();
        if (ph) out.push({ t: "TERM", v: ph, ph: true });
        i = j + 1; continue;
      }
      if (c === "-" && i + 1 < n && !/[\s-]/.test(s[i + 1]) && (i === 0 || /[\s(,|&]/.test(s[i - 1]))) { out.push({ t: "NOT" }); i++; continue; }
      var k = i; while (k < n && !/[\s(),|&"“”]/.test(s[k])) k++;
      var w = s.slice(i, k); i = k;
      if (w === "AND" || w === "OR" || w === "NOT") { out.push({ t: w }); continue; }
      w = w.replace(/\*+$/, "");
      if (w) out.push({ t: "TERM", v: w });
    }
    return out;
  }
  function parse(s) {
    var tk = tokens(s), p = 0, nTerms = 0;
    function peek() { return tk[p] && tk[p].t; }
    function orE(d) {
      if (d > MAX_DEPTH) throw new Error("too many brackets inside brackets");
      var kids = [andE(d)];
      while (peek() === "OR") { p++; kids.push(andE(d)); }
      return kids.length === 1 ? kids[0] : { op: "or", k: kids };
    }
    function andE(d) {
      var kids = [notE(d)];
      for (;;) {
        var t = peek();
        if (t === "AND") { p++; kids.push(notE(d)); continue; }
        if (t === "TERM" || t === "NOT" || t === "(") { kids.push(notE(d)); continue; }
        break;
      }
      return kids.length === 1 ? kids[0] : { op: "and", k: kids };
    }
    function notE(d) {
      if (peek() === "NOT") { p++; return { op: "not", k: [notE(d)] }; }
      return atom(d);
    }
    function atom(d) {
      var t = tk[p];
      if (!t) throw new Error("the search ends too early");
      if (t.t === "(") { p++; var e = orE(d + 1); if (peek() !== ")") throw new Error("a bracket is not closed"); p++; return e; }
      if (t.t === "TERM") { p++; if (++nTerms > MAX_TERMS) throw new Error("more than " + MAX_TERMS + " words"); return { term: t.v }; }
      throw new Error(t.t === ")" ? "a closing bracket has no opening one" : t.t + " needs a word after it");
    }
    if (!tk.length) return null;
    var tree = orE(0);
    if (p < tk.length) throw new Error(tk[p].t === ")" ? "a closing bracket has no opening one" : "unexpected " + tk[p].t);
    return tree;
  }

  /* ---------- match ---------- */
  var reCache = {};
  function termRe(k) {
    var re = reCache[k];
    if (!re) {
      try { re = new RegExp("(^|[^\\p{L}\\p{N}])" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu"); }
      catch (e) { var lk = k.toLowerCase(); re = { test: function (t) { return t.toLowerCase().indexOf(lk) >= 0; } }; }
      reCache[k] = re;
    }
    return re;
  }
  function ev(n, txt) {
    if (n.term != null) return termRe(n.term).test(txt);
    if (n.op === "not") return !ev(n.k[0], txt);
    if (n.op === "and") { for (var i = 0; i < n.k.length; i++) if (!ev(n.k[i], txt)) return false; return true; }
    for (var j = 0; j < n.k.length; j++) if (ev(n.k[j], txt)) return true;
    return false;
  }
  /* the words that count towards a hit (not the NOT ones), in order */
  function positives(n, neg, out) {
    if (!n) return out;
    if (n.term != null) { if (!neg && out.indexOf(n.term) < 0) out.push(n.term); return out; }
    n.k.forEach(function (c) { positives(c, n.op === "not" ? !neg : neg, out); });
    return out;
  }
  function show(n, top) {
    if (n.term != null) return /[\s,|&()]/.test(n.term) || /^(AND|OR|NOT)$/.test(n.term) ? '"' + n.term + '"' : n.term;
    if (n.op === "not") return "NOT " + show(n.k[0]);
    var s = n.k.map(function (c) { return show(c); }).join(n.op === "and" ? " AND " : " OR ");
    return top ? s : "(" + s + ")";
  }

  /* true when the text uses Boolean syntax; a plain comma list stays the old any-of list */
  function isBool(s) { return /\bAND\b|\bOR\b|\bNOT\b|["“”()|&]|(^|[\s(,])-[^\s-]/.test(String(s || "")); }

  var cCache = {};
  /* compile(s) -> { ok, err, q (tidied string), terms (positive words), test(txt), which(txt) } */
  function compile(s) {
    s = String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (cCache[s]) return cCache[s];
    var r;
    try {
      if (s.length > MAX_LEN) throw new Error("longer than " + MAX_LEN + " characters");
      var tree = parse(s);
      if (!tree) throw new Error("no words");
      var terms = positives(tree, false, []);
      r = { ok: true, q: show(tree, true), terms: terms,
        test: function (txt) { return ev(tree, txt); },
        which: function (txt) { if (!ev(tree, txt)) return ""; for (var i = 0; i < terms.length; i++) if (termRe(terms[i]).test(txt)) return terms[i]; return terms[0] || "match"; } };
    } catch (e) {
      r = { ok: false, err: String(e.message || e), q: s, terms: [], test: function () { return false; }, which: function () { return ""; } };
    }
    var ks = Object.keys(cCache); if (ks.length > 200) cCache = {};
    cCache[s] = r;
    return r;
  }

  /* ---------- quick searches ---------- */
  /* Built for what an analyst or a security team in country would watch (the same scope as tools/relevance.json). English, since
     OSAP translates headlines; the original-language text is matched too. */
  var PRESETS = [
    { id: "ied", name: "Bombs and IEDs", q: '(bomb OR IED OR explosive OR explosion OR blast OR detonat OR grenade OR landmine OR "car bomb" OR "suicide bomber" OR "bomb disposal" OR "suspicious object") NOT (bombshell OR bombard OR "photo bomb")' },
    { id: "shoot", name: "Shootings and armed attacks", q: '(shooting OR gunmen OR gunfire OR ambush OR "armed attack" OR "opened fire" OR sniper OR assassinat) NOT ("photo shoot" OR "film shoot")' },
    { id: "unrest", name: "Protest and unrest", q: '(protest OR riot OR demonstrat OR "tear gas" OR "water cannon" OR clashes OR curfew OR "general strike" OR looting OR "rubber bullets") NOT (sport OR football OR concert)' },
    { id: "milmove", name: "Military movement", q: '(troops OR convoy OR deploy OR mobiliz OR mobilis OR "military exercise" OR "live-fire" OR warship OR "naval vessel" OR "fighter jet" OR buildup OR "armoured vehicle" OR "armored vehicle") NOT (anniversary OR parade OR recruitment)' },
    { id: "militant", name: "Militants and terrorism", q: '(militant OR insurgent OR terroris OR jihad OR "armed group" OR rebel OR separatist OR extremis OR "Islamic State" OR ISIS OR "al-Qaeda") NOT (film OR novel OR game)' },
    { id: "kidnap", name: "Kidnap and hostages", q: '(kidnap OR abduct OR hostage OR ransom OR "taken captive" OR "held captive")' },
    { id: "scam", name: "Scam centres and trafficking", q: '("scam centre" OR "scam center" OR "scam compound" OR "scam hub" OR "online scam" OR "human trafficking" OR "forced labour" OR "forced labor" OR "trafficking victims" OR "cyber fraud")' },
    { id: "foreign", name: "Threats to foreigners", q: '(foreigner OR foreign OR tourist OR American OR "US citizen" OR expat OR embassy OR consulate) AND (attack OR killed OR kidnap OR abduct OR detained OR arrested OR threat OR warning OR assault OR robbed)' },
    { id: "maritime", name: "Maritime incidents", q: '("coast guard" OR coastguard OR piracy OR pirates OR "armed robbery at sea" OR boarded OR "vessel seized" OR "ship seized" OR "water cannon" OR "maritime militia" OR collision OR "dark vessel")' },
    { id: "coup", name: "Coup and political crisis", q: '(coup OR "martial law" OR "state of emergency" OR junta OR impeach OR "no-confidence" OR "government collapse" OR "snap election" OR "mass arrests")' },
    { id: "drones", name: "Drones", q: '(drone OR UAV OR UAS OR "unmanned aerial" OR quadcopter OR "loitering munition") NOT ("drone show" OR "drone light" OR delivery OR racing)' },
    { id: "border", name: "Border incidents", q: '("border clash" OR "border crossing" OR "border closed" OR "border closure" OR checkpoint OR incursion OR "cross-border" OR smuggl OR "border patrol") NOT (tourism OR visa-free)' },
    { id: "cyber", name: "Cyber attacks and outages", q: '(cyberattack OR "cyber attack" OR hacked OR hackers OR ransomware OR "data breach" OR "internet shutdown" OR "internet outage" OR blackout OR "power outage")' },
    { id: "health", name: "Disease outbreaks", q: '(outbreak OR epidemic OR cholera OR dengue OR "bird flu" OR avian OR mpox OR measles OR ebola OR anthrax OR "unknown illness")' }
  ];

  /* ---------- rules-built draft from a plain description ---------- */
  /* Each concept: words that call it up (matched at the start of a word the user typed) and the Boolean words it adds.
     kind: what = the incident, who = the target or actor, where = the setting. Concepts of one kind are OR-ed together,
     kinds are AND-ed, so "bombings and shootings of police" becomes (bomb... OR shooting...) AND (police...). */
  var CONCEPTS = [
    { kind: "what", on: ["bomb", "ied", "explo", "blast", "grenade", "landmine", "mine"], q: ["bomb", "IED", "explosive", "explosion", "blast", "grenade", "landmine", "detonat"] },
    { kind: "what", on: ["shoot", "gun", "gunmen", "gunman", "gunfire", "gunshot", "firefight", "sniper", "ambush", "assassin"], q: ["shooting", "gunmen", "gunfire", "ambush", "sniper", "assassinat", "\"opened fire\""] },
    { kind: "what", on: ["attack", "assault", "raid", "violen"], q: ["attack", "assault", "raid", "violence"] },
    { kind: "what", on: ["kill", "death", "dead", "murder", "casualt", "fatal"], q: ["killed", "dead", "murder", "casualties", "fatal"] },
    { kind: "what", on: ["protest", "riot", "unrest", "demonstr", "rally", "strike", "clash"], q: ["protest", "riot", "unrest", "demonstrat", "rally", "clashes", "\"tear gas\"", "\"general strike\""] },
    { kind: "what", on: ["kidnap", "abduct", "hostage", "ransom"], q: ["kidnap", "abduct", "hostage", "ransom"] },
    { kind: "what", on: ["arrest", "detain", "raid", "crackdown", "charge"], q: ["arrest", "detained", "detention", "crackdown", "charged", "raid"] },
    { kind: "what", on: ["scam", "fraud", "traffick", "forced", "centre", "center", "compound"], q: ["scam", "\"scam centre\"", "\"scam center\"", "fraud", "trafficking", "\"forced labour\"", "\"forced labor\""] },
    { kind: "what", on: ["drug", "narcot", "meth", "heroin", "smuggl", "seiz", "contraband"], q: ["drug", "narcotic", "meth", "heroin", "smuggl", "seized", "seizure", "contraband"] },
    { kind: "what", on: ["move", "movement", "deploy", "convoy", "mobili", "buildup", "exercise", "drill", "manoeuv", "maneuv"], q: ["deploy", "convoy", "troops", "mobiliz", "mobilis", "buildup", "\"military exercise\"", "drill", "\"live-fire\""] },
    { kind: "what", on: ["coup", "junta", "martial", "emergency", "crisis", "impeach"], q: ["coup", "junta", "\"martial law\"", "\"state of emergency\"", "crisis", "impeach"] },
    { kind: "what", on: ["drone", "uav", "uas", "unmanned"], q: ["drone", "UAV", "UAS", "\"unmanned aerial\""] },
    { kind: "what", on: ["missile", "rocket", "artillery", "shell", "airstrike", "strike"], q: ["missile", "rocket", "artillery", "shelling", "airstrike", "strike"] },
    { kind: "what", on: ["cyber", "hack", "ransomware", "breach", "outage", "blackout", "shutdown"], q: ["cyberattack", "hacked", "ransomware", "\"data breach\"", "outage", "blackout", "\"internet shutdown\""] },
    { kind: "what", on: ["outbreak", "disease", "epidemic", "virus", "cholera", "dengue", "flu"], q: ["outbreak", "epidemic", "cholera", "dengue", "\"bird flu\"", "mpox", "measles"] },
    { kind: "what", on: ["flood", "storm", "typhoon", "cyclone", "quake", "earthquake", "landslide", "disaster", "tsunami", "eruption"], q: ["flood", "storm", "typhoon", "cyclone", "earthquake", "landslide", "tsunami", "eruption", "evacuat"] },
    { kind: "what", on: ["threat", "warn", "alert"], q: ["threat", "warning", "alert"] },
    { kind: "what", on: ["piracy", "pirate", "boarding", "boarded", "collision", "seized"], q: ["piracy", "pirates", "boarded", "\"vessel seized\"", "collision"] },
    { kind: "who", on: ["police", "cop", "officer", "checkpoint"], q: ["police", "officers", "checkpoint", "\"police station\""] },
    { kind: "who", on: ["soldier", "army", "military", "troop", "ranger", "marine", "navy", "air force"], q: ["soldiers", "army", "military", "troops", "rangers", "navy", "\"military base\""] },
    { kind: "who", on: ["foreign", "tourist", "expat", "american", "westerner", "embassy", "consulate", "us citizen"], q: ["foreigner", "foreign", "tourist", "expat", "American", "embassy", "consulate"] },
    { kind: "who", on: ["official", "government", "minister", "politic", "mayor", "governor", "leader"], q: ["official", "government", "minister", "politician", "governor", "mayor"] },
    { kind: "who", on: ["teacher", "school", "student", "monk", "temple", "mosque", "church", "civilian", "villager"], q: ["teacher", "school", "student", "monk", "temple", "mosque", "church", "civilian", "villager"] },
    { kind: "who", on: ["insurgent", "militant", "rebel", "separatist", "terror", "jihad", "extremist", "gang", "cartel", "armed group"], q: ["insurgent", "militant", "rebel", "separatist", "terroris", "extremis", "\"armed group\"", "gang", "cartel"] },
    { kind: "who", on: ["infrastructure", "power", "pipeline", "bridge", "railway", "airport", "port", "dam", "grid", "telecom"], q: ["infrastructure", "\"power line\"", "pipeline", "bridge", "railway", "train", "airport", "port", "dam", "grid"] },
    { kind: "where", on: ["border", "frontier", "crossing"], q: ["border", "frontier", "\"border crossing\"", "cross-border"] },
    { kind: "where", on: ["coast guard", "sea", "maritime", "coast", "ship", "vessel", "boat", "fishing", "ferry"], q: ["maritime", "\"coast guard\"", "coastguard", "vessel", "ship", "boat", "ferry"] },
    { kind: "where", on: ["capital", "city", "downtown", "urban"], q: ["capital", "city"] }
  ];
  var STOP = ("a an the of in on at to for from by with about into over near around across along inside outside within any all some " +
    "news report reports reporting story stories incident incidents event events activity activities thing things " +
    "watch watching alert me tell show find look looking get want need i we my our us please when where what which who whose " +
    "is are was were be been being have has had do does did can could should would will new latest recent recently today " +
    "and or also plus including involving targeting against between during after before especially mainly mostly related " +
    "area areas region regions province provinces district districts country countries place places").split(" ");
  var NEG_RE = /\b(?:but not|except(?: for)?|excluding|exclude|without|ignore|ignoring|not about|not|no)\b/i;

  function words(s) { return s.split(/[^\p{L}\p{N}'-]+/u).map(function (w) { return w.replace(/^['-]+|['-]+$/g, ""); }).filter(Boolean); }
  function conceptOf(w) {
    var lw = w.toLowerCase();
    for (var i = 0; i < CONCEPTS.length; i++) for (var j = 0; j < CONCEPTS[i].on.length; j++) {
      var o = CONCEPTS[i].on[j];
      if (o.indexOf(" ") < 0 && (o.length >= 4 ? lw.indexOf(o) === 0 : lw === o || lw === o + "s")) return i;
    }
    return -1;
  }
  function quote(t) { return /\s/.test(t) ? '"' + t + '"' : t; }
  function grp(list) { return list.length === 1 ? list[0] : "(" + list.join(" OR ") + ")"; }

  /* draft(text) -> { q, parts: [{label, words}], note } or { err } */
  function draft(text) {
    var s = String(text || "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!s) return { err: "Type what you want to hear about first." };
    var phrases = [];
    s = s.replace(/["“”]([^"“”]+)["“”]/g, function (m, p) { phrases.push(p.trim()); return " "; });
    var neg = "", m = s.match(NEG_RE);
    if (m) { neg = s.slice(m.index + m[0].length); s = s.slice(0, m.index); }
    function scan(str, lowerOnly) {
      var ws = words(str), cons = [], names = [], other = [], run = [];
      /* two-word triggers first (air force, armed group, us citizen) */
      CONCEPTS.forEach(function (c, i) { c.on.forEach(function (o) {
        if (o.indexOf(" ") < 0) return;
        var ow = o.split(" ");
        for (var a = 0; a + ow.length <= ws.length; a++) {
          if (ow.every(function (x, b) { return ws[a + b].toLowerCase().indexOf(x) === 0; })) { if (cons.indexOf(i) < 0) cons.push(i); ws.splice(a, ow.length); a--; }
        }
      }); });
      function flush() { if (run.length) { names.push(run.join(" ")); run = []; } }
      ws.forEach(function (w, idx) {
        var ci = conceptOf(w), lw = w.toLowerCase();
        var cap = !lowerOnly && /^\p{Lu}/u.test(w) && !(idx === 0 && ci >= 0) && STOP.indexOf(lw) < 0;
        if (cap && ci < 0) { run.push(w); return; }
        flush();
        if (ci >= 0) { if (cons.indexOf(ci) < 0) cons.push(ci); return; }
        if (STOP.indexOf(lw) >= 0 || lw.length < 3 || /^\d+$/.test(lw)) return;
        if (other.indexOf(lw) < 0) other.push(lw);
      });
      flush();
      return { cons: cons, names: names, other: other };
    }
    var pos = scan(s), parts = [], groups = [];
    ["what", "who", "where"].forEach(function (kind) {
      var ws = [];
      pos.cons.forEach(function (i) { if (CONCEPTS[i].kind === kind) CONCEPTS[i].q.forEach(function (w) { if (ws.indexOf(w) < 0) ws.push(w); }); });
      if (ws.length) { groups.push(grp(ws)); parts.push({ label: { what: "What happened", who: "Who or what is involved", where: "Setting" }[kind], words: ws }); }
    });
    var named = phrases.concat(pos.names).map(quote);
    if (named.length) { groups.push(grp(named)); parts.push({ label: "Places or names (any one)", words: named }); }
    if (pos.other.length) { groups.push(grp(pos.other)); parts.push({ label: "Other words (any one)", words: pos.other }); }
    if (!groups.length) return { err: "No words to search for were found. Try naming the incident, e.g. bombings near the border." };
    var q = groups.join(" AND ");
    if (neg) {
      /* what to leave out is taken word for word: widening "fishing" to every boat word would drop what was asked for */
      var nw = [];
      words(neg).forEach(function (w) { var lw = w.toLowerCase(); if (STOP.indexOf(lw) < 0 && lw.length >= 3 && nw.indexOf(w) < 0) nw.push(w); });
      if (nw.length) { q += " NOT " + grp(nw); parts.push({ label: "Leave out", words: nw }); }
    }
    var c = compile(q);
    if (!c.ok) return { err: "The draft did not come out right (" + c.err + "). Try shorter wording." };
    return { q: c.q, parts: parts };
  }

  var api = { compile: compile, isBool: isBool, draft: draft, presets: PRESETS, MAX_LEN: MAX_LEN };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OSAP_BOOLQ = api;
})(this);
