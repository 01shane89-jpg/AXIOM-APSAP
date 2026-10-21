/* AXIOM OSAP: Key dates, the dates that matter to an analyst in one country: the past 7 days and the next 60.
   - Public holidays: Nager.Date (https://date.nager.at, MIT licence), about 120 countries; a government list, shown as "official".
   - Elections and referendums with a set day: Wikipedia's national electoral calendar (CC BY-SA 4.0), a reported schedule,
     shown as "claimed" (check it with the electoral commission).
   - Anniversaries of violence: each country's deadliest days of the last ten years in the UCDP Georeferenced Event Dataset
     (CC BY 4.0), with UCDP's own death estimate and a link to the event; shown as "computed".
   These three come from data/live/keydates/<cc>.json, written daily by tools/refresh_keydates.mjs (.github/workflows/refresh-keydates.yml).
   - Religious and seasonal dates, computed on this device and shown as "computed": the Islamic dates from the Umm al-Qura
     calendar (Intl.DateTimeFormat "islamic-umalqura"; local moon sighting can move them a day or two), Lunar New Year from the
     Chinese calendar, Jewish holidays from the Hebrew calendar, Western and Orthodox Easter by the standard computus, Christmas,
     Diwali from a table of published dates, Songkran and the other April new years, and Nowruz. Which countries get which is
     a rough guide by the size of each community, said on the page.
   No national days of armed groups: no free public list of them was found; their anniversaries show up only through UCDP.
   Dates are the country's local calendar days; each also shows when that day starts in Zulu. Nothing here is an assessment:
   the "why it matters" lines are fixed wording by kind of date, not a forecast.
   Shown as a "Key dates" card on Today (assets/osap-today.js: the next three, "Show all") and as a full list after the
   country report in the Country brief (index.html openBrief). window.OSAP_KEYDATES {cardHtml, briefHtml, fillBrief, openAll, core}. */
(function (G, factory) {
  var api = factory(G);
  if (typeof module === "object" && module.exports) module.exports = api.core;
  else G.OSAP_KEYDATES = api;
})(typeof window !== "undefined" ? window : globalThis, function (W) {
  "use strict";
  var DAY = 864e5, PAST = 7, AHEAD = 60;

  /* ================= core: pure, tested in node (tests/keydates.test.mjs) ================= */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(ms) { var d = new Date(ms); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function msOf(ymd) { return Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)); }
  function addDays(ymd, n) { return ymdOf(msOf(ymd) + n * DAY); }
  /* Western (Gregorian) Easter Sunday, anonymous Gregorian algorithm */
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return y + "-" + pad(mo) + "-" + pad(da);
  }
  /* Orthodox Easter Sunday: Julian computus, moved to the Gregorian calendar (+13 days, 1900-2099) */
  function orthodoxEaster(y) {
    var a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7, mo = Math.floor((d + e + 114) / 31), da = ((d + e + 114) % 31) + 1;
    return addDays(y + "-" + pad(mo) + "-" + pad(da), 13);
  }
  /* a calendar's month and day for a Gregorian day, through Intl (null when the browser lacks that calendar) */
  var FMT = {};
  function calParts(cal, ymd, monthStyle) {
    var k = cal + "|" + (monthStyle || "numeric"), f = FMT[k];
    if (f === null) return null;
    if (!f) {
      try { f = new Intl.DateTimeFormat("en-u-ca-" + cal, { timeZone: "UTC", year: "numeric", month: monthStyle || "numeric", day: "numeric" });
        if (f.resolvedOptions().calendar !== cal) f = null; } catch (e) { f = null; }
      FMT[k] = f; if (!f) return null;
    }
    var p = {}; f.formatToParts(new Date(msOf(ymd) + 12 * 36e5)).forEach(function (x) { p[x.type] = x.value; });
    return p;
  }
  /* Diwali (Lakshmi Puja) as published for India; some regions keep it a day earlier or later */
  var DIWALI = { 2024: "2024-11-01", 2025: "2025-10-20", 2026: "2026-11-08", 2027: "2027-10-29", 2028: "2028-10-17", 2029: "2029-11-05", 2030: "2030-10-26",
    2031: "2031-11-14", 2032: "2032-11-02", 2033: "2033-10-22", 2034: "2034-11-10", 2035: "2035-10-30" };
  function set(s) { var o = {}; s.split(" ").forEach(function (k) { o[k] = 1; }); return o; }
  /* who keeps what: a rough guide by community size (majority or a large share), not a census */
  var ISLAM = set("af al az bh bd bn bf td km dj dz eg gm gn id ir iq jo kz xk kw kg lb ly my mv ml mr ma ne ng om pk ps qa sa sn sl so sd ss sy tj tn tr tm ae uz eh ye er et ci gh tz ke mz ug cm bj tg gw lr in lk ph th ru cn ba mk me sg mu gy sr tt fj il cf");
  var SHIA = set("ir iq lb bh az pk af ye sa kw sy");
  var NOXMAS = set("af ir sa ye om ae qa kw bh ly dz tn ma mr eh so dj km mv tm uz tj kp mn cn jp th la kh mm bt np tr az bd pk af");
  var ORTHO = set("ru ua by md ro bg rs me mk ge am gr cy et er eg ba xk kz kg");
  var JAN7 = set("ru ua by rs me mk ge et er eg kz kg md ba");
  var HINDU = set("in np mu fj gy sr tt lk bd bt my sg");
  var LUNAR = set("cn tw kr kp vn sg my id bn ph th");
  var JEWISH = set("il ps");
  var NOWRUZ = set("ir af tj az kz uz kg tm iq sy tr");
  var APRIL = { th: ["Songkran (Thai New Year)", "04-13", "04-15"], la: ["Pi Mai (Lao New Year)", "04-14", "04-16"], mm: ["Thingyan (water festival and New Year)", "04-13", "04-16"],
    kh: ["Khmer New Year", "04-14", "04-16"], lk: ["Sinhala and Tamil New Year", "04-13", "04-14"] };
  var WHY = {
    ramadan: "Month of fasting: working hours shorten, evenings get crowded; armed groups have both stepped up and paused attacks in this month.",
    ramadanEnd: "Last day of the fast; Eid al-Fitr follows, with travel and closures.",
    fitr: "Eid al-Fitr: a holiday of several days; travel peaks, offices close, mosques and markets are crowded.",
    adha: "Eid al-Adha: major holiday of several days; travel, livestock markets, crowded prayers, offices closed.",
    hijri: "Islamic New Year: a public holiday in many Muslim-majority countries.",
    ashura: "Ashura: Shia mourning processions draw large crowds and have been targeted in sectarian attacks.",
    mawlid: "Mawlid (the Prophet's birthday): processions in some countries; rejected by some Salafi groups.",
    xmas: "Christmas: churches crowded and travel up; churches have been attacked on this day in some countries.",
    xmas7: "Orthodox Christmas: churches crowded, holiday in Orthodox countries.",
    easter: "Easter: the main Christian holiday; crowded churches over the weekend, a past target of attacks in some countries.",
    oeaster: "Orthodox Easter: the main Orthodox holiday; crowded churches and travel.",
    goodfri: "Good Friday: a public holiday in many Christian countries; processions.",
    diwali: "Diwali: festival of lights; travel peaks, fireworks and crowded markets; air quality drops.",
    lunar: "Lunar New Year: a week-long holiday with mass travel; businesses and government offices close.",
    april: "New Year holiday: mass travel home and crowded streets; road deaths rise sharply.",
    nowruz: "Nowruz (Persian New Year): a long holiday and peak travel; Kurdish Newroz rallies can turn political.",
    rosh: "Rosh Hashanah (Jewish New Year): closures; starts at sunset the evening before.",
    kippur: "Yom Kippur: almost all activity stops in Israel, including broadcasting and roads; starts at sunset the evening before.",
    pesach: "Passover begins: holiday week, travel and closures; starts at sunset the evening before.",
    pub: "Public holiday: government offices, courts and many businesses close; travel and crowds rise.",
    natday: "National day: official ceremonies, parades and heavier security; a date protests or attacks may aim at.",
    bank: "Bank holiday: banks and some offices close.",
    obs: "Observance: not a day off for most, but marked publicly.",
    election: "Scheduled national vote: campaign events, protests and disputes about the result can follow; security deployments are usual.",
    referendum: "National referendum: campaigning, protests and disputes about the result can follow; security deployments are usual.",
    indirect: "Indirect election (by parliament or a council): few crowds, but it can bring political tension."
  };
  var SRC_CAL = { islamic: "https://en.wikipedia.org/wiki/Islamic_calendar#Saudi_Arabia's_Umm_al-Qura_calendar", chinese: "https://en.wikipedia.org/wiki/Chinese_New_Year",
    hebrew: "https://en.wikipedia.org/wiki/Hebrew_calendar", easter: "https://en.wikipedia.org/wiki/Date_of_Easter", diwali: "https://en.wikipedia.org/wiki/Diwali",
    xmas: "https://en.wikipedia.org/wiki/Christmas", nowruz: "https://en.wikipedia.org/wiki/Nowruz", april: "https://en.wikipedia.org/wiki/Songkran_(Thailand)" };
  function rel(title, date, why, src, note, end, key) {
    return { date: date, end: end || "", kind: "religious", title: title, why: why, src: src, srcName: "Computed on this device", status: "computed", note: note || "", key: key || "" };
  }
  /* the religious and seasonal dates for one country between two days (inclusive) */
  function religious(cc, from, to) {
    var out = [], c = cc === "oki" ? "jp" : cc;
    var y0 = +from.slice(0, 4), y1 = +to.slice(0, 4), y, d;
    function inR(x) { return x >= from && x <= to; }
    if (ISLAM[c] || LUNAR[c] || JEWISH[c]) {
      for (d = addDays(from, -1); d <= addDays(to, 1); d = addDays(d, 1)) {
        var nx = addDays(d, 1);
        if (ISLAM[c]) {
          var h = calParts("islamic-umalqura", d);
          if (h) {
            var hm = +h.month, hd = +h.day, NOTE = "Umm al-Qura calendar; where the new moon is sighted locally the day can move by one or two.";
            if (inR(d)) {
              if (hm === 9 && hd === 1) out.push(rel("Ramadan begins (1 Ramadan " + h.year + ")", d, WHY.ramadan, SRC_CAL.islamic, NOTE, "", "ramadan"));
              if (hm === 10 && hd === 1) out.push(rel("Eid al-Fitr", d, WHY.fitr, SRC_CAL.islamic, NOTE, "", "fitr"));
              if (hm === 12 && hd === 10) out.push(rel("Eid al-Adha", d, WHY.adha, SRC_CAL.islamic, NOTE, "", "adha"));
              if (hm === 1 && hd === 1) out.push(rel("Islamic New Year (1 Muharram " + h.year + ")", d, WHY.hijri, SRC_CAL.islamic, NOTE, "", "hijri"));
              if (hm === 1 && hd === 10) out.push(rel("Ashura", d, WHY.ashura + (SHIA[c] ? "" : " Most observed where there are Shia communities."), SRC_CAL.islamic, NOTE, "", "ashura"));
              if (hm === 3 && hd === 12) out.push(rel("Mawlid (the Prophet's birthday)", d, WHY.mawlid, SRC_CAL.islamic, NOTE, "", "mawlid"));
              var hn = calParts("islamic-umalqura", nx);
              if (hm === 9 && hn && +hn.month === 10) out.push(rel("Ramadan ends (last day of the fast)", d, WHY.ramadanEnd, SRC_CAL.islamic, NOTE, "", "ramadanEnd"));
            }
          }
        }
        if (LUNAR[c] && inR(d)) {
          var ch = calParts("chinese", d);
          if (ch && ch.month === "1" && +ch.day === 1) out.push(rel("Lunar New Year" + (c === "vn" ? " (Tết)" : c === "kr" || c === "kp" ? " (Seollal)" : ""), d, WHY.lunar, SRC_CAL.chinese, "Chinese lunisolar calendar.", "", "lunar"));
        }
        if (JEWISH[c] && inR(d)) {
          var he = calParts("hebrew", d, "long");
          if (he) {
            var N = "Hebrew calendar; the day begins at sunset the evening before.";
            if (he.month === "Tishri" && +he.day === 1) out.push(rel("Rosh Hashanah", d, WHY.rosh, SRC_CAL.hebrew, N, "", "rosh"));
            if (he.month === "Tishri" && +he.day === 10) out.push(rel("Yom Kippur", d, WHY.kippur, SRC_CAL.hebrew, N, "", "kippur"));
            if (he.month === "Nisan" && +he.day === 15) out.push(rel("Passover begins", d, WHY.pesach, SRC_CAL.hebrew, N, "", "pesach"));
          }
        }
      }
    }
    for (y = y0; y <= y1; y++) {
      if (!NOXMAS[c]) {
        var ea = easter(y);
        if (inR(ea)) out.push(rel("Easter Sunday", ea, WHY.easter, SRC_CAL.easter, "Gregorian computus.", "", "easter"));
        if (inR(addDays(ea, -2))) out.push(rel("Good Friday", addDays(ea, -2), WHY.goodfri, SRC_CAL.easter, "Gregorian computus.", "", "goodfri"));
        if (inR(y + "-12-25")) out.push(rel("Christmas Day", y + "-12-25", WHY.xmas, SRC_CAL.xmas, "", "", "xmas"));
      }
      if (ORTHO[c]) { var oe = orthodoxEaster(y); if (inR(oe) && oe !== easter(y)) out.push(rel("Orthodox Easter Sunday", oe, WHY.oeaster, SRC_CAL.easter, "Julian computus.", "", "oeaster")); }
      if (JAN7[c] && inR(y + "-01-07")) out.push(rel("Orthodox Christmas", y + "-01-07", WHY.xmas7, SRC_CAL.xmas, "Julian calendar 25 December.", "", "xmas7"));
      if (HINDU[c] && DIWALI[y] && inR(DIWALI[y])) out.push(rel("Diwali", DIWALI[y], WHY.diwali, SRC_CAL.diwali, "Date as published for India; some regions keep it a day earlier or later.", "", "diwali"));
      if (NOWRUZ[c] && inR(y + "-03-21")) out.push(rel(c === "tr" || c === "iq" || c === "sy" ? "Newroz (Kurdish New Year)" : "Nowruz (New Year)", y + "-03-21", WHY.nowruz, SRC_CAL.nowruz, "At the March equinox, 20 or 21 March.", "", "nowruz"));
      var ap = APRIL[c];
      if (ap) { var s = y + "-" + ap[1], e = y + "-" + ap[2]; if (s <= to && e >= from) out.push(rel(ap[0], s, WHY.april, SRC_CAL.april, "Days set by custom; the government fixes the holiday each year.", e, "april")); }
    }
    return out;
  }
  var NATDAY = /\b(independence|national|republic|revolution|liberation|victory|constitution|unity|unification|martyrs?|heroes|armed forces|army|statehood|sovereignty|union|day of the nation|founding|king'?s birthday|queen'?s birthday)\b/i;
  /* holiday rows from the data file -> items */
  function holidayItems(list, from, to) {
    /* the same holiday listed once nationally and again for some regions is shown once: national if any, else the regions joined */
    var seen = {}, rows = [];
    (list || []).forEach(function (h) {
      if (!h || h.date < from || h.date > to) return;
      var k = h.date + "|" + h.name, o = seen[k];
      if (!o) { o = seen[k] = { date: h.date, name: h.name, local: h.local, types: h.types, src: h.src, regional: h.regional ? h.regional.slice() : null }; rows.push(o); return; }
      if (!h.regional || !o.regional) o.regional = null; else h.regional.forEach(function (r) { if (o.regional.indexOf(r) < 0) o.regional.push(r); });
    });
    return rows.map(function (h) {
      var t = h.types || [], nat = NATDAY.test(h.name || ""), pub = t.indexOf("Public") >= 0 || !t.length;
      return { date: h.date, end: "", kind: "holiday", title: h.name + (h.local ? " (" + h.local + ")" : ""), status: "official", src: h.src, srcName: "Nager.Date public holidays",
        why: (nat ? WHY.natday : pub ? WHY.pub : t.indexOf("Bank") >= 0 ? WHY.bank : WHY.obs) + (h.regional ? " Regional: " + h.regional.slice(0, 6).map(function (r) { return String(r).replace(/^[A-Z]{2}-/, ""); }).join(", ") + (h.regional.length > 6 ? "…" : "") + "." : ""),
        note: t.join(", "), regional: !!h.regional };
    });
  }
  function electionItems(list, from, to) {
    return (list || []).filter(function (e) { return e && (e.end || e.date) >= from && e.date <= to; }).map(function (e) {
      return { date: e.date, end: e.end || "", kind: "election", title: (e.kind === "referendum" ? "Referendum: " : e.indirect ? "Indirect election: " : "Election: ") + e.title,
        why: e.indirect ? WHY.indirect : e.kind === "referendum" ? WHY.referendum : WHY.election, status: "claimed", src: e.src || e.page, srcName: "Wikipedia national electoral calendar",
        note: "Reported schedule; check the electoral commission." };
    });
  }
  var VTYPE = { 1: "fighting between a government and an armed group", 2: "fighting between armed groups", 3: "violence against civilians" };
  /* anniversaries in [from, to]: the same month and day in each year the window touches (29 February -> 28 February) */
  function anniversaryItems(list, from, to) {
    var out = [], y0 = +from.slice(0, 4), y1 = +to.slice(0, 4);
    (list || []).forEach(function (a) {
      if (!a || !/^\d{4}-\d\d-\d\d$/.test(a.date || "")) return;
      for (var y = y0; y <= y1; y++) {
        var md = a.date.slice(5), yrs = y - +a.date.slice(0, 4);
        if (md === "02-29" && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) md = "02-28";
        var d = y + "-" + md;
        if (yrs < 1 || d < from || d > to) continue;
        var sides = [a.a, a.b].filter(Boolean).join(" against ");
        out.push({ date: d, end: "", kind: "anniversary", status: "computed", src: a.src, srcName: "UCDP Georeferenced Event Dataset",
          title: yrs + (yrs === 1 ? " year" : " years") + " since " + (a.best >= 1 ? "about " + a.best + " deaths" : "deadly violence") + " (" + a.date + ")" +
            (a.where ? ": " + (a.where.length > 70 ? a.where.slice(0, 68).replace(/\s+\S*$/, "") + "…" : a.where) : ""),
          why: "Anniversary of one of the country's deadliest days in UCDP's record" + (a.type && VTYPE[a.type] ? " (" + VTYPE[a.type] + (sides ? ": " + sides : "") + ")" : sides ? " (" + sides + ")" : "") +
            ". Anniversaries can bring commemorations, protests or reprisals.",
          note: "UCDP best estimate, " + a.n + (a.n === 1 ? " event" : " events") + " that day" + (a.adm1 ? ", " + a.adm1 : "") + "." });
      }
    });
    return out;
  }
  /* one country's list for the window around `today` (local YYYY-MM-DD): data file parts plus computed dates, sorted, duplicates dropped */
  var SAME = { xmas: /christmas|noel|navidad|natal|weihnacht/i, xmas7: /christmas|orthodox/i, easter: /easter|pascua|p[aâ]ques|ostern|pasqua/i, goodfri: /good friday|viernes santo|vendredi saint|karfreitag/i,
    oeaster: /easter/i, fitr: /fitr|ramadan|eid|bayram/i, adha: /adha|sacrifice|kurban|tabaski|bakri|eid/i, hijri: /islamic new year|hijri|muharram/i, ashura: /ashura/i, mawlid: /mawlid|prophet|milad|mouloud/i,
    lunar: /lunar|chinese new year|spring festival|t[eế]t|seollal/i, diwali: /diwali|deepavali/i, april: /songkran|new year|thingyan|pi mai/i, nowruz: /nowruz|newroz|nauryz|navruz/i,
    rosh: /rosh/i, kippur: /kippur/i, pesach: /passover|pesach/i, ramadan: /ramadan/i, ramadanEnd: /^$/ };
  function build(cc, data, today) {
    var from = addDays(today, -PAST), to = addDays(today, AHEAD), d = data || {};
    var hol = holidayItems(d.holidays, from, to), list = hol.concat(electionItems(d.elections, from, to), anniversaryItems(d.anniversaries, from, to));
    religious(cc, from, to).forEach(function (r) {
      /* the official list wins when it already has the day (within a day either side for the moon-sighted dates) */
      var re = SAME[r.key] || /^$/;
      var dup = hol.some(function (h) { return re.test(h.title) && Math.abs(msOf(h.date) - msOf(r.date)) <= DAY * (/fitr|adha|hijri|ashura|mawlid|ramadan/.test(r.key) ? 1 : 0); });
      if (!dup) list.push(r);
    });
    var rank = { election: 0, holiday: 1, religious: 2, anniversary: 3 };
    list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (rank[a.kind] - rank[b.kind]) || (a.regional ? 1 : 0) - (b.regional ? 1 : 0); });
    return { from: from, to: to, today: today, items: list };
  }
  var core = { easter: easter, orthodoxEaster: orthodoxEaster, religious: religious, holidayItems: holidayItems, electionItems: electionItems,
    anniversaryItems: anniversaryItems, build: build, addDays: addDays, PAST: PAST, AHEAD: AHEAD };
  if (!W.document) return { core: core };

  /* ================= page ================= */
  var D = W.document;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function curCc() { return (W.TSAP && W.TSAP.country) || "th"; }
  function zone(cc) { var T = W.OSAP_TIME; return T && T.zone ? T.zone((W.OSAP_TZMAP || {})[cc]) : "UTC"; }
  /* today's date in the country's main time zone */
  function localToday(cc) {
    var tz = zone(cc);
    try { var p = {}; new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; }); return p.year + "-" + p.month + "-" + p.day; }
    catch (e) { return ymdOf(Date.now()); }
  }
  /* when a local calendar day starts, in Zulu: "Sat 7 Nov 2100Z" */
  function zStart(ymd, cc) {
    var T = W.OSAP_TIME, tz = zone(cc), ms = T && T.parseT ? T.parseT(ymd + " 00:00", tz) : msOf(ymd);
    if (!isFinite(ms)) return "";
    var d = new Date(ms);
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) + " " + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + "Z";
  }
  function dayLabel(ymd, withYear) { return new Date(msOf(ymd)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: withYear ? "numeric" : undefined, timeZone: "UTC" }); }
  function rangeLabel(it, withYear) { return dayLabel(it.date, withYear) + (it.end && it.end !== it.date ? " to " + dayLabel(it.end, withYear) : ""); }
  function inDays(it, today) { var n = Math.round((msOf(it.date) - msOf(today)) / DAY); return n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : n > 0 ? "in " + n + " days" : -n + " days ago"; }
  var ST = { official: ["Official", "Government holiday list (Nager.Date)"], computed: ["Computed", "Worked out from a calendar or a record, not announced by anyone"], claimed: ["Claimed", "A reported schedule (Wikipedia): check with the electoral commission"] };
  var KIND = { holiday: "Holiday", religious: "Religious", election: "Election", anniversary: "Anniversary" };

  var cache = {}, waiting = {};
  function load(cc, cb) {
    var c = cache[cc];
    if (c && (c.state === "ok" || c.state === "err")) return c;
    if (cb) (waiting[cc] = waiting[cc] || []).push(cb);
    if (c) return c;
    c = cache[cc] = { state: "loading", data: null };
    var done = function () { var w = waiting[cc] || []; waiting[cc] = []; w.forEach(function (f) { try { f(); } catch (e) {} }); };
    if (!W.fetch) { c.state = "err"; return c; }
    W.fetch("data/live/keydates/" + encodeURIComponent(cc) + ".json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { c.state = "ok"; c.data = j; done(); refresh(cc); })
      .catch(function (e) { c.state = "err"; c.err = String(e && e.message || e); done(); refresh(cc); });
    return c;
  }
  function listFor(cc) { var c = cache[cc] || load(cc); return build(cc, c.data, localToday(cc)); }
  function credits(c) {
    var s = (c && c.data && c.data.sources) || {}, a = c && c.data && c.data.ucdp;
    return "Holidays: <a href=\"https://date.nager.at\" target=\"_blank\" rel=\"noopener noreferrer\">Nager.Date</a> (" + esc((s.holidays || {}).licence || "MIT") + "). " +
      "Elections: <a href=\"" + esc(safeUrl((s.elections || {}).url) || "https://en.wikipedia.org/") + "\" target=\"_blank\" rel=\"noopener noreferrer\">Wikipedia national electoral calendar</a> (CC BY-SA 4.0). " +
      "Anniversaries: <a href=\"https://ucdp.uu.se/downloads/\" target=\"_blank\" rel=\"noopener noreferrer\">UCDP GED</a>" + (a && a.release ? " " + esc(String(a.release).replace(/-csv\.zip$/, "")) + ", to " + esc(a.last || "") : "") + " (CC BY 4.0). " +
      "Religious dates computed on this device." + (c && c.data && c.data.asof ? " File built " + esc(W.OSAP_TIME && W.OSAP_TIME.asofT ? W.OSAP_TIME.asofT(c.data.asof) : c.data.asof) + "." : "");
  }
  function stateNote(c) {
    if (!c || c.state === "loading") return "Loading holidays, elections and anniversaries…";
    if (c.state === "err") return "Holidays, elections and anniversaries could not be loaded (" + esc(navigator.onLine === false ? "offline" : "not available on this plan or not built yet") + "); only the computed dates are shown.";
    return "";
  }
  function noHol(c) { return c && c.state === "ok" && c.data && !(c.data.holidays || []).length ? "Nager.Date has no public holiday list for this country, so its official holidays are not shown." : ""; }
  function tag(st) { var s = ST[st] || ST.computed; return '<span class="kdst kd-' + esc(st) + '" title="' + esc(s[1]) + '">' + esc(s[0]) + "</span>"; }
  function srcLink(it) { var u = safeUrl(it.src); return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" title="' + esc(it.srcName || "Source") + '">Source ↗</a>' : ""; }

  /* ---------- Today card: the next three ---------- */
  var redraw = {};
  function cardHtml(cc, onReady) {
    cc = cc || curCc(); if (onReady) redraw.today = onReady;
    var c = load(cc, null), L = build(cc, c.data, localToday(cc)), up = L.items.filter(function (i) { return (i.end || i.date) >= L.today; });
    var h = '<section class="tdcard tdkd" aria-label="Key dates"><div class="tdh"><h2>Key dates</h2><span class="tdcount">next ' + AHEAD + " days, local date · Zulu start</span></div>";
    var note = stateNote(c) || noHol(c); if (note) h += '<p class="tdobs">' + note + "</p>";
    if (!up.length) h += '<p class="tdobs">No holiday, election, religious date or anniversary is held for the next ' + AHEAD + " days.</p>";
    up.slice(0, 3).forEach(function (it) {
      h += '<div class="kdrow"><div class="kdd"><b>' + esc(rangeLabel(it)) + '</b><span class="kdz">' + esc(inDays(it, L.today)) + " · from " + esc(zStart(it.date, cc)) + "</span></div>" +
        '<div class="kdb"><span class="kdt">' + esc(it.title) + "</span>" + '<span class="kdw">' + esc(it.why) + "</span>" +
        '<span class="kdm"><span class="kdk">' + esc(KIND[it.kind] || it.kind) + "</span>" + tag(it.status) + srcLink(it) + "</span></div></div>";
    });
    h += '<div class="tdlinks"><button type="button" class="tdlink" data-kdall>Show all ' + L.items.length + " (past " + PAST + " and next " + AHEAD + ' days)</button></div><p class="tdsrc">' + credits(c) + "</p></section>";
    return h;
  }

  /* ---------- the full list (country brief, or its own sheet) ---------- */
  function tableHtml(cc) {
    var c = cache[cc] || load(cc), L = build(cc, c.data, localToday(cc)), tz = zone(cc);
    var past = L.items.filter(function (i) { return (i.end || i.date) < L.today; }), next = L.items.filter(function (i) { return (i.end || i.date) >= L.today; });
    function rows(arr) {
      return arr.map(function (it) {
        return "<tr><td class=\"kdc\"><b>" + esc(rangeLabel(it, true)) + '</b><br><span class="kdz">' + esc(inDays(it, L.today)) + "<br>starts " + esc(zStart(it.date, cc)) + "</span></td>" +
          '<td class="w"><b>' + esc(it.title) + "</b><br>" + esc(it.why) + (it.note ? ' <span class="kdz">' + esc(it.note) + "</span>" : "") + "</td>" +
          "<td>" + esc(KIND[it.kind] || it.kind) + "<br>" + tag(it.status) + "</td><td>" + srcLink(it) + "</td></tr>";
      }).join("");
    }
    var head = '<tr><th>Date (local)<br><span class="kdz">start in Zulu</span></th><th>What and why it matters</th><th>Kind</th><th>Source</th></tr>';
    var note = [stateNote(c), noHol(c)].filter(Boolean).join(" ");
    return (note ? '<p class="bm">' + note + "</p>" : "") +
      '<p class="bm">Local dates are the country\'s calendar days (' + esc(tz) + "); each row also says when that day starts in Zulu. Today is " + esc(dayLabel(L.today, true)) + " there. " +
      "Official: a government holiday list. Claimed: a reported schedule to check. Computed: worked out from a calendar or from UCDP's event record. The \"why it matters\" lines are fixed wording by kind of date, not an assessment.</p>" +
      "<h3>Next " + AHEAD + " days</h3>" + (next.length ? '<table class="kdtab">' + head + rows(next) + "</table>" : '<p class="bm">Nothing held for the next ' + AHEAD + " days.</p>") +
      "<h3>Past " + PAST + " days</h3>" + (past.length ? '<table class="kdtab">' + head + rows(past) + "</table>" : '<p class="bm">Nothing in the past ' + PAST + " days.</p>") +
      '<p class="bm kdcred">' + credits(c) + " Religious dates: the Umm al-Qura, Chinese and Hebrew calendars in this browser, the Easter computus and a published Diwali table; which countries show which is a rough guide by community size. " +
      "National days of armed groups are not listed: no free public list was found.</p>";
  }
  function name(cc) { var c = cache[cc]; return (c && c.data && c.data.name) || ((W.ASAP_WORLD || []).filter(function (x) { return x.id === cc; })[0] || {}).name || cc.toUpperCase(); }
  function briefHtml(cc) {
    cc = cc || curCc(); css();
    return '<article class="bpage breport" id="keydates"><header><div><b>AXIOM OSAP</b> · Key dates</div><h2>' + esc(name(cc)) + "</h2></header>" + '<div id="kd-body">' + tableHtml(cc) + "</div></article>";
  }
  function fillBrief() { var cc = curCc(); load(cc, null); var b = D.getElementById("kd-body"); if (b) b.innerHTML = tableHtml(cc); }
  function refresh(cc) {
    if (cc !== curCc()) return;
    var b = D.getElementById("kd-body"); if (b) b.innerHTML = tableHtml(cc);
    var s = D.getElementById("kd-sheet-body"); if (s) s.innerHTML = tableHtml(cc);
    if (redraw.today) try { redraw.today(); } catch (e) {}
  }
  /* "Show all": the country brief, scrolled to the key dates; its own sheet when the brief is not available in this view */
  function openAll() {
    var cc = curCc(), bb = D.getElementById("brief-btn");
    if (W.OSAP_TODAY && W.OSAP_TODAY.isOpen()) W.OSAP_TODAY.hide();
    if (bb) {
      bb.click();
      var go = function () { var k = D.getElementById("keydates"); if (k) k.scrollIntoView({ block: "start" }); };
      go(); setTimeout(go, 150); setTimeout(go, 500);
      return;
    }
    css();
    var s = D.getElementById("kd-sheet");
    if (!s) {
      s = D.createElement("div"); s.id = "kd-sheet"; s.setAttribute("role", "dialog"); s.setAttribute("aria-label", "Key dates");
      D.body.appendChild(s);
      s.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("[data-kdclose]")) s.hidden = true; });
    }
    s.innerHTML = '<div class="kdsh"><div class="kdbar"><b>Key dates · ' + esc(name(cc)) + '</b><button type="button" data-kdclose>Close</button></div><div id="kd-sheet-body">' + tableHtml(cc) + "</div></div>";
    s.hidden = false;
  }
  var cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true;
    var s = D.createElement("style");
    s.textContent = [
      ".tdkd .kdrow{display:flex;gap:10px;padding:7px 0;border-top:1px solid var(--line-soft,var(--line))}.tdkd .kdrow:first-of-type{border-top:0}",
      ".tdkd .kdd{flex:0 0 7.6em;display:flex;flex-direction:column;font-variant-numeric:tabular-nums}.tdkd .kdd b{font-size:13px}",
      ".tdkd .tdlink{min-height:40px}.kdz{font-size:11.5px;color:var(--muted)}.tdkd .kdb{display:flex;flex-direction:column;gap:2px;min-width:0}.tdkd .kdt{font-weight:600;overflow-wrap:anywhere}",
      ".tdkd .kdw{font-size:12.5px}.tdkd .kdm{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px}.kdk{font-size:11px;color:var(--muted)}",
      ".kdst{display:inline-block;font-size:10.5px;font-weight:600;border:1px solid currentColor;border-radius:9px;padding:0 7px;line-height:17px}",
      ".kd-official{color:var(--accent,#1a5a8a)}.kd-computed{color:var(--muted,#667)}.kd-claimed{color:var(--near,#a60)}",
      "#keydates table.kdtab{width:100%;border-collapse:collapse;font-size:.92em}#keydates table.kdtab th,#keydates table.kdtab td,#kd-sheet table.kdtab th,#kd-sheet table.kdtab td{border-top:1px solid #c9d1d9;padding:4px 5px;text-align:left;vertical-align:top}",
      ".kdtab th:nth-child(1){width:19%}.kdtab th:nth-child(2){width:57%}.kdtab th:nth-child(3){width:13%}.kdtab th:nth-child(4){width:11%}",
      "#kd-sheet table.kdtab{width:100%;border-collapse:collapse;font-size:13px}.kdtab td.kdc{white-space:nowrap;font-variant-numeric:tabular-nums}",
      "@media (max-width:560px){.kdtab td.kdc{white-space:normal}}",
      "#kd-sheet{position:fixed;inset:0;z-index:6000;background:var(--bg,var(--surface,#fff));color:var(--ink,#111);overflow:auto;-webkit-overflow-scrolling:touch}",
      ".kdsh{max-width:1100px;margin:0 auto;padding:max(8px,env(safe-area-inset-top)) 16px 24px;font-size:14px;line-height:1.45}",
      ".kdbar{display:flex;align-items:center;gap:8px;position:sticky;top:0;background:var(--bg,var(--surface,#fff));padding:8px 0;border-bottom:1px solid var(--line,#ccc)}.kdbar b{flex:1;font-size:17px}",
      ".kdbar button{font:inherit;min-height:40px;padding:6px 14px;border:1px solid var(--line,#ccc);border-radius:6px;background:var(--surface,#fff);color:var(--ink,#111);cursor:pointer}",
      "@media print{#keydates table.kdtab tr{break-inside:avoid}}"
    ].join("");
    D.head.appendChild(s);
  }
  css();
  return { cardHtml: cardHtml, briefHtml: briefHtml, fillBrief: fillBrief, openAll: openAll, list: listFor, load: load, core: core };
});
