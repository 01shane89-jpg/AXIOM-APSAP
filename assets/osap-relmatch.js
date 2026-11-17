/* RELATED-STORY MATCH RULES (pure, no page state). index.html relatedStories() finds the words two reports share; this file
   decides whether those shared words are enough to call the reports "related", so the rule can be tested on its own
   (tests/relmatch.test.mjs).

   Why (Shane 2026-11-08, "Rangers seize 'Happy Water'", a drug seizure on the Mekong): the connected stories were a beef seizure
   in Malaysia, a Cambodian rain forecast, a flood, a water shortage and polluted river water. They matched on one word, "water"
   or "seize". Now:
   - news words that turn up in every kind of story (seize, arrest, water, river...) count half;
   - two shared words side by side ("happy water") count extra, because a name is stronger than two loose words;
   - each report is sorted into kinds of event (drugs, flood, fraud...) from its words. The same kind adds weight; two different
     kinds with nothing else in common (drugs vs rain) is not a match;
   - the same headline from the same source (one video uploaded twice) is listed once.
   A match is still not a confirmed link between the stories; the list says so. */
(function () {
  "use strict";
  /* words that appear across unrelated kinds of story: shared alone, they say little */
  var GENERIC = {};
  ("seize seized seizes seizing seizure seizures arrest arrests arrested arresting suspect suspects suspected investigation investigations " +
   "investigate investigating probe charged charges water waters river rivers province district village city town officers officer " +
   "authorities authority forces force security team teams found case cases million billion hundreds thousands calls call warns warning " +
   "urges issues issued plans plan meeting talks says said claims claim latest breaking video watch clip nov november").split(" ").forEach(function (w) { GENERIC[w] = 1; });

  /* kinds of event, matched on a report's own words (English and Thai). A report can be more than one kind. */
  var KINDS = [
    ["drugs", /\b(drugs?|narcotics?|meth(amphetamine)?|amphetamines?|yaba|ya ba|heroin|cocaine|ketamine|crystal meth|ice pills?|kratom|cannabis|marijuana|opium|happy water|traffickers?|pills?)\b|ยาบ้า|ยาเสพติด|ยาไอซ์|ไอซ์|เฮโรอีน|เคตามีน|น้ำหวานแฮปปี้|แฮปปี้วอเตอร์/],
    ["flood", /\b(floods?|flooding|flash flood|inundat\w*|deluge|overflow\w*|landslides?|mudslides?)\b|น้ำท่วม|อุทกภัย|ดินโคลนถล่ม|น้ำป่า/],
    ["weather", /\b(rain|rains|rainfall|thunderstorms?|storms?|typhoon|cyclone|monsoon|weather|forecast|heatwave|drought|water shortage|temperatures?|cold front|hail)\b|ฝนตก|พายุ|มรสุม|ภัยแล้ง|อากาศ/],
    ["pollution", /\b(pollut\w*|black water|wastewater|toxic|contaminat\w*|pm ?2\.5|smog|haze|chemical spill|oil spill)\b|มลพิษ|น้ำเสีย|ฝุ่น/],
    ["fraud", /\b(fraud\w*|scams?|scammers?|call cent(er|re)s?|money laundering|launder\w*|forg(ed|ery)|fake (id|documents?)|identity|embezzl\w*|bribe\w*|corrupt\w*)\b|ฉ้อโกง|แก๊งคอลเซ็นเตอร์|ฟอกเงิน|ทุจริต|ปลอม/],
    ["food", /\b(beef|meat|pork|chicken|halal|food safety|livestock|cattle|cows?|rice prices?)\b|เนื้อวัว|หมูเถื่อน/],
    ["violence", /\b(shoot\w*|shot|gunm[ae]n|bomb\w*|explosi\w*|ied|attack\w*|ambush\w*|insurgen\w*|militants?|killed|stabb\w*|grenade)\b|ยิง|ระเบิด|ลอบวาง|คนร้าย/],
    ["fire", /\b(fires?|blaze|burn(ed|t|ing)?|wildfires?|arson)\b|ไฟไหม้|เพลิงไหม้/],
    ["quake", /\b(earthquakes?|quakes?|tremors?|tsunami|magnitude)\b|แผ่นดินไหว/],
    ["traffic", /\b(crash\w*|collisions?|accidents?|road deaths?|overturn\w*|derail\w*)\b|อุบัติเหตุ|รถชน|รถคว่ำ/],
    ["politics", /\b(election\w*|parliament|minister|cabinet|vote|votes|voting|party|parties|senate|prime minister|coalition|campaign)\b|เลือกตั้ง|รัฐสภา|รัฐมนตรี|พรรค/],
    ["protest", /\b(protest\w*|rall(y|ies)|demonstrat\w*|march(es|ed)?|strike|strikes)\b|ชุมนุม|ประท้วง/],
    ["migration", /\b(migrants?|refugees?|asylum|illegal (entry|workers?)|undocumented|deport\w*|human trafficking)\b|แรงงานต่างด้าว|ผู้ลี้ภัย/],
    ["health", /\b(disease|outbreak|virus|dengue|cholera|covid|vaccin\w*|hospital|patients?|epidemic)\b|ไข้เลือดออก|โรคระบาด/],
    ["border", /\b(border|crossings?|checkpoints?)\b|ชายแดน|ด่าน/]
  ];
  /* kinds that often go together in one story (a drug haul at the border, a flood after rain): sharing one counts, and neither
     clashes with the other */
  var NEAR_KIND = { drugs: ["border", "violence", "migration"], flood: ["weather"], weather: ["flood"], fraud: ["migration"], border: ["drugs", "migration", "violence"], migration: ["border", "drugs", "fraud"], violence: ["drugs", "border"] };

  var BROAD = { politics: 1, protest: 1, weather: 1, border: 1, violence: 1, traffic: 1, health: 1 };
  function kinds(text) {
    var t = String(text || "").toLowerCase(), out = [];
    KINDS.forEach(function (k) { if (k[1].test(t)) out.push(k[0]); });
    /* "border" alone says where, not what happened: it is a kind only next to another one */
    if (out.length === 1 && out[0] === "border") return [];
    return out;
  }
  /* two shared words that stand side by side in the text itself (not just once the other words are taken out) */
  function pairs(text, set) {
    var list = String(text || "").toLowerCase().split(/[^0-9a-zÀ-ɏ฀-๿぀-ヿ一-鿿가-힯]+/).filter(Boolean), o = {};
    for (var i = 1; i < list.length; i++) if (set[list[i - 1]] && set[list[i]] && list[i - 1] !== list[i]) o[list[i - 1] + " " + list[i]] = 1;
    return o;
  }

  /* how strongly two reports are tied by their words.
     shared: words both have (already without the words common to many records); a, b: the two reports' texts.
     Returns { str, kind ("same" | "clash" | ""), kindName, pairs, why } */
  function strength(shared, a, b) {
    var set = {}; shared.forEach(function (w) { set[w] = 1; });
    var str = 0; shared.forEach(function (w) { str += GENERIC[w] ? 0.5 : 1; });
    var pa = pairs(a, set), pb = pairs(b, set), np = 0, pn = [];
    Object.keys(pa).forEach(function (p) { if (pb[p]) { var ws = p.split(" "); if (!(GENERIC[ws[0]] && GENERIC[ws[1]])) { np++; pn.push(p); } } });
    str += np * 1.5;
    var ka = kinds(a), kb = kinds(b), same = ka.filter(function (k) { return kb.indexOf(k) >= 0; });
    var close = !same.length && ka.some(function (k) { return (NEAR_KIND[k] || []).some(function (n) { return kb.indexOf(n) >= 0; }); });
    var kind = same.length ? "same" : ka.length && kb.length && !close ? "clash" : "";
    /* a broad kind (politics, weather...) says less than a narrow one (drugs, quake) */
    if (kind === "same") str += BROAD[same[0]] && same.every(function (k) { return BROAD[k]; }) ? 0.5 : 1;
    return { str: str, kind: kind, kindName: same[0] || "", pairs: pn, why: kind === "same" ? "both " + same[0] + " reports" : "" };
  }
  /* enough to list: other reports (news, records, open data) */
  function enough(m, near, dt) {
    if (near && dt != null && dt <= 3) return true;              /* close in place and time: the Report's own "nearby" rule */
    if (m.kind === "clash") return m.str >= 3 && near;           /* different kinds of event need a lot in common, and the place */
    return m.str >= 2 || (m.str >= 1 && near);
  }
  /* enough to list: social posts (short, fast, and noisy: never one loose word) */
  function enoughSocial(m, near, dd) {
    if (m.kind === "clash") return false;
    return m.str >= 2 || (m.str >= 1 && near && dd <= 3);
  }
  /* one entry per headline and source: the same video uploaded twice under one title is shown once */
  function dupKey(title, src) {
    return String(src || "").toLowerCase().replace(/\s+/g, " ").trim() + "|" + String(title || "").toLowerCase().replace(/[^0-9a-zÀ-ɏ฀-๿぀-ヿ一-鿿가-힯]+/g, " ").trim();
  }
  var api = { kinds: kinds, strength: strength, enough: enough, enoughSocial: enoughSocial, dupKey: dupKey, GENERIC: GENERIC };
  if (typeof window !== "undefined") window.OSAP_RELMATCH = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
