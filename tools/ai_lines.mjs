// Two faults in an AI-written summary line that the source headlines do not have (tools/daily_lib.mjs validateAi and its re-check
// of kept summaries, dropOverclaims). Both found in the 20 Nov summaries:
//   actorCountryAdded(text, heads): the line gives an institution a country no cited headline gives it. The World summary said
//     "Iran's Senate rejects war powers resolution to end the conflict with Iran"; The Hill, CBS News and The Jerusalem Post said
//     "Senate Republicans reject war powers resolution to end Iran conflict", the US Senate. A country (or its people's name) right
//     before a state institution ("Iran's Senate", "the Iranian parliament", "Senate of Iran") is rejected when a cited headline
//     has that institution and names that country, but never within three words of each other: the country there ("to end Iran
//     conflict") is the subject of the story, not the owner of the Senate. Returns the phrase, or "".
//   cutOff(text): the line stops mid-sentence (Taiwan, 20 Nov: "... road closures in Tai 14 A line section from 18K Tsui-pieng to
//     32.7K Matsue-lu due to"). The unfinished sentence is cut back to the last whole one; "" when no whole sentence is left.
const INST = "senate|parliament|congress|house of representatives|national assembly|assembly|legislature|lawmakers|cabinet|government|" +
  "military|army|navy|air force|armed forces|coast guard|police|president|prime minister|foreign minister|foreign ministry|defen[cs]e minist(?:er|ry)|" +
  "supreme court|constitutional court|central bank|election commission|state media|embassy|ambassador|king|junta|regime";
// countries and their people's names as the news writes them (Intl region names; the common demonyms by hand)
const DEMONYM = { US: "American|U\\.S\\.|US|United States", GB: "British|UK|U\\.K\\.", CN: "Chinese", RU: "Russian", IR: "Iranian", IL: "Israeli",
  UA: "Ukrainian", JP: "Japanese", KR: "South Korean|Korean", KP: "North Korean", IN: "Indian", PK: "Pakistani", AF: "Afghan", IQ: "Iraqi",
  SY: "Syrian", LB: "Lebanese", TR: "Turkish", SA: "Saudi", EG: "Egyptian", FR: "French", DE: "German", IT: "Italian", ES: "Spanish",
  PL: "Polish", TH: "Thai", KH: "Cambodian", MM: "Myanmar|Burmese", VN: "Vietnamese", PH: "Philippine|Filipino", ID: "Indonesian",
  MY: "Malaysian", TW: "Taiwanese", VE: "Venezuelan", MX: "Mexican", BR: "Brazilian", AR: "Argentine|Argentinian", CO: "Colombian",
  CU: "Cuban", HT: "Haitian", NG: "Nigerian", ET: "Ethiopian", SD: "Sudanese", YE: "Yemeni", QA: "Qatari", AE: "Emirati|UAE",
  JO: "Jordanian", GE: "Georgian", AM: "Armenian", AZ: "Azerbaijani", BY: "Belarusian", RS: "Serbian", HU: "Hungarian", RO: "Romanian",
  GR: "Greek", NL: "Dutch", BE: "Belgian", SE: "Swedish", NO: "Norwegian", FI: "Finnish", DK: "Danish", CA: "Canadian", AU: "Australian",
  NZ: "New Zealand", BD: "Bangladeshi", LK: "Sri Lankan", NP: "Nepali|Nepalese", ZA: "South African", KE: "Kenyan", SO: "Somali",
  LY: "Libyan", TN: "Tunisian", DZ: "Algerian", MA: "Moroccan", PS: "Palestinian", CL: "Chilean", PE: "Peruvian", BO: "Bolivian",
  EC: "Ecuadorian", NI: "Nicaraguan", HN: "Honduran", GT: "Guatemalan", SV: "Salvadoran", PA: "Panamanian", DO: "Dominican" };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let C = null;
const countries = () => {
  if (C) return C;
  const en = new Intl.DisplayNames(["en"], { type: "region" }), by = new Map();
  for (let a = 65; a < 91; a++) for (let b = 65; b < 91; b++) {
    const cc = String.fromCharCode(a, b);
    if (["UN", "EU", "EZ", "QO", "ZZ"].includes(cc)) continue;
    let n; try { n = en.of(cc); } catch { continue; }
    if (!n || n === cc || /Unknown|Outlying|Pseudo|\(/.test(n) && !/Myanmar/.test(n)) continue;
    const name = n.replace(/\s*\(.*\)$/, "");
    const forms = [esc(name)].concat(DEMONYM[cc] ? [DEMONYM[cc]] : []);
    by.set(name, [...new Set([...(by.get(name) || []), ...forms])]);
  }
  C = [...by].map(([name, forms]) => ({ name, re: forms.join("|") }));
  return C;
};
const W = "[\\p{L}\\p{N}'’.-]+", SP = "[\\s:,;–—-]+";
// a country up to three words before an institution ("US Senate", "Myanmar: Junta carries out"), or the institution "of" it
// ("Senate of Iran"); "Prime Minister raises issue of Thai invasion" does not make the prime minister Thai
const nearRe = (re, inst) => {
  const ci = /^American|^U\\\./.test(re) ? "" : "i";
  return new RegExp(`(?<![\\p{L}])(?:${re})(?![\\p{L}])(?:['’]s)?(?:${SP}${W}){0,3}?${SP}${esc(inst)}\\b|\\b${esc(inst)}\\s+(?:of|in)\\s+(?:the\\s+)?(?:${re})(?![\\p{L}])`, "u" + ci);
};
export function actorCountryAdded(text, heads) {
  text = String(text || ""); const hs = (heads || []).map((h) => String(h || "")).filter(Boolean);
  if (!hs.length) return "";
  for (const { re } of countries()) {
    // "Iran's Senate", "the Iranian parliament", "Senate of Iran"; US and UK only in capitals
    const ci = /^American|^U\\\./.test(re) ? "" : "i";
    const own = new RegExp(`(?<![\\p{L}])(?:${re})(?:['’]s)?\\s+(?:${INST})\\b|\\b(?:${INST})\\s+of\\s+(?:the\\s+)?(?:${re})(?![\\p{L}])`, "u" + ci);
    const m = text.match(own); if (!m) continue;
    const inst = m[0].match(new RegExp(INST, "i"))[0];
    // the cited headline has this country within three words of the same institution (either side), or names the pair outright
    if (hs.some((h) => nearRe(re, inst).test(h))) continue;
    // only the mix-up is caught: a cited headline gives the same institution to another country ("US Senate", "Malaysia's
    // military"). A headline that names no owner ("Supreme Court dismisses appeal ... Kingdom of Bahrain") leaves the line alone,
    // since the model then gives the context the outlet's readers have.
    const other = countries().find((o) => o.re !== re && hs.some((h) => nearRe(o.re, inst).test(h)));
    if (!other) continue;
    return m[0];
  }
  return "";
}
const DANGLING = /\b(?:due to|because of|according to|as well as|such as|and|or|but|the|a|an|of|to|in|on|at|for|from|with|by|as|than|into|over|after|before|between|while|whose|which|that|including|amid|near)\s*$/i;
export function cutOff(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  if (/[.!?…)"”’\]]$/.test(t) && !DANGLING.test(t.replace(/[.!?…]+$/, ""))) return t;
  if (!DANGLING.test(t) && /[\p{L}\p{N}]$/u.test(t) && t.split(/\s+/).length >= 4) return t;   // a line without a full stop is still whole
  // the last sentence end: a stop (and a closing quote or bracket) before a space and a capital, so "32.7K" is not one
  let end = -1;
  for (const m of t.matchAll(/[.!?…]["”’)\]]?(?=\s+[\p{Lu}\p{N}"“(])/gu)) end = m.index + m[0].length;
  const head = end > 0 ? t.slice(0, end) : "";
  return head.length > 15 ? head : "";
}
