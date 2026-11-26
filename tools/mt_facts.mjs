// Facts a machine translation may not add: casualty counts and casualty words the original does not carry.
// 2026-11-15: MADLAD-400 turned "Iranische Revolutionsgarden melden neuen Drohnenangriff auf US-Stützpunkt im Bahrain"
// (Deutschlandfunk) into "Iran's Revolutionary Guards Forces Attack U.S. Base in Bahrain, Kill 10", and the Latvian, Serbian
// and Greek reports of the same attack each gained "killed 10" too. None of the originals mentions a death. The number check
// in tools/mt_guard.mjs let it through: a small number (up to 12) was allowed for a number word ("cinco", "douze") whenever
// the original had no digits. A scan of every stored translation (2026-11-16) found 514 headlines with a casualty count the
// original does not give, nearly all of them "10" ("Neun Tote" -> "10 dead", "Tote bei Erdbeben" -> "Earthquake kills 10",
// "Mueren seis en un incendio" -> "Six killed in Brooklyn fire, 10 injured").
//   extraCount(orig, en): a count of dead, injured, missing, arrested or abducted people in the English (in digits or words) that
//     the original does not give in digits, in Chinese, Japanese or Korean numerals, or as a number word (NUMBER_WORDS).
//   extraHarm(orig, en, lang): the English says people were killed, died or were injured and the original has no word for
//     death, killing or injury (HARM_STEMS) in its language. Only judged when the original's language (or, without a language
//     tag, its script) is one HARM_STEMS covers; anything else is left to the other checks.
// Both lean towards rejecting: a rejected line shows the original headline, marked not translated, which can never state
// something the source did not. Pure: no files, no network.

// Lowercase, accents and other marks dropped, and the letters that do not decompose written plainly, so "Tötet", "tötet" and
// "totet" read the same. Arabic and Persian letter forms are made one (أ إ آ -> ا, ی -> ي, ک -> ك, ة -> ه).
export function fold(s) {
  return String(s || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/ß/g, "ss").replace(/[øœ]/g, "o").replace(/æ/g, "ae").replace(/ł/g, "l").replace(/đ/g, "d").replace(/ı/g, "i").replace(/ħ/g, "h")
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/[یى]/g, "ي").replace(/ک/g, "ك").replace(/ة/g, "ه").replace(/ـ/g, "");
}
// scripts written with spaces between words, where a stem must start a word; other scripts are matched anywhere
const WORDED = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Georgian}]/u;
const LETTER = /[\p{L}\p{N}]/u;
// stems: "word" must be the whole word, "stem*" must start one; "_" stands for a space
function compile(list) { return list.split(/\s+/).filter(Boolean).map((w) => ({ s: fold(w.replace(/\*$/, "").replace(/_/g, " ")), pre: w.endsWith("*") })); }
function hasStem(text, st, anywhere) {
  const word = WORDED.test(st.s[0]) && !(anywhere && [...st.s].length > 3);
  for (let i = text.indexOf(st.s); i >= 0; i = text.indexOf(st.s, i + 1)) {
    if (!word) return true;
    if (LETTER.test(text[i - 1] || "")) continue;
    if (st.pre || !LETTER.test(text[i + st.s.length] || "")) return true;
  }
  return false;
}

// Number words, value then the words for it. Used only to accept a count, so a stem that also starts an unrelated word
// ("sept" in "septembre") can only let a line through that the other checks judge; it never rejects one.
const NUMBER_WORDS_SRC = {
  de: "1 ein eine einer einen einem eines; 2 zwei*; 3 drei*; 4 vier*; 5 fünf*; 6 sechs*; 7 sieben*; 8 acht*; 9 neun*; 10 zehn*; 11 elf; 12 zwölf* dutzend*; 13 dreizehn*; 14 vierzehn*; 15 fünfzehn*; 16 sechzehn*; 17 siebzehn*; 18 achtzehn*; 19 neunzehn*; 20 zwanzig*; 30 dreißig*; 40 vierzig*; 50 fünfzig*; 60 sechzig*; 70 siebzig*; 80 achtzig*; 90 neunzig*; 100 hundert*",
  nl: "1 een één; 2 twee*; 3 drie*; 4 vier*; 5 vijf*; 6 zes*; 7 zeven*; 8 acht*; 9 negen*; 10 tien*; 11 elf; 12 twaalf* dozijn*; 13 dertien*; 14 veertien*; 15 vijftien*; 16 zestien*; 17 zeventien*; 18 achttien*; 19 negentien*; 20 twintig*; 30 dertig*; 40 veertig*; 50 vijftig*; 60 zestig*; 70 zeventig*; 80 tachtig*; 90 negentig*; 100 honderd*",
  fr: "1 un une; 2 deux; 3 trois; 4 quatre; 5 cinq; 6 six; 7 sept; 8 huit; 9 neuf; 10 dix dizaine*; 11 onze; 12 douze douzaine*; 13 treize; 14 quatorze; 15 quinze quinzaine*; 16 seize; 17 dix-sept; 18 dix-huit; 19 dix-neuf; 20 vingt* vingtaine*; 30 trente* trentaine*; 40 quarante* quarantaine*; 50 cinquante* cinquantaine*; 60 soixante* soixantaine*; 80 quatre-vingts quatre-vingt; 100 cent cents centaine*",
  es: "1 un uno una; 2 dos; 3 tres; 4 cuatro; 5 cinco; 6 seis; 7 siete; 8 ocho; 9 nueve; 10 diez decena*; 11 once; 12 doce docena*; 13 trece; 14 catorce; 15 quince; 16 dieciséis; 17 diecisiete; 18 dieciocho; 19 diecinueve; 20 veinte* veintena*; 30 treinta*; 40 cuarenta*; 50 cincuenta*; 60 sesenta*; 70 setenta*; 80 ochenta*; 90 noventa*; 100 cien ciento* centenar*",
  pt: "1 um uma; 2 dois duas; 3 três; 4 quatro; 5 cinco; 6 seis; 7 sete; 8 oito; 9 nove; 10 dez dezena*; 11 onze; 12 doze dúzia*; 13 treze; 14 catorze quatorze; 15 quinze; 16 dezesseis dezasseis; 17 dezessete dezassete; 18 dezoito; 19 dezenove dezanove; 20 vinte*; 30 trinta*; 40 quarenta*; 50 cinquenta*; 60 sessenta*; 70 setenta*; 80 oitenta*; 90 noventa*; 100 cem cento* centena*",
  it: "1 un uno una; 2 due; 3 tre; 4 quattro; 5 cinque; 6 sei; 7 sette; 8 otto; 9 nove; 10 dieci decina*; 11 undici; 12 dodici dozzina*; 13 tredici; 14 quattordici; 15 quindici; 16 sedici; 17 diciassette; 18 diciotto; 19 diciannove; 20 venti* ventina*; 30 trenta*; 40 quaranta*; 50 cinquanta*; 60 sessanta*; 70 settanta*; 80 ottanta*; 90 novanta*; 100 cento* centinaio*",
  ca: "1 un una; 2 dos dues; 3 tres; 4 quatre; 5 cinc; 6 sis; 7 set; 8 vuit; 9 nou; 10 deu desena*; 11 onze; 12 dotze; 20 vint*; 30 trenta*; 50 cinquanta*; 100 cent",
  ro: "1 un una unu; 2 doi două doua; 3 trei; 4 patru; 5 cinci; 6 șase sase; 7 șapte sapte; 8 opt; 9 nouă; 10 zece; 11 unsprezece; 12 doisprezece douăsprezece; 20 douăzeci; 30 treizeci; 50 cincizeci; 100 sută suta",
  ru: "1 один одна одно одного одной; 2 два две двух двое двоих; 3 три трех трое троих; 4 четыр* четвер*; 5 пят* пятер*; 6 шест* шестер*; 7 сем* семер*; 8 восем* восьм*; 9 девят*; 10 десят* десяток* десятк*; 11 одиннадцат*; 12 двенадцат* дюжин*; 13 тринадцат*; 14 четырнадцат*; 15 пятнадцат*; 16 шестнадцат*; 17 семнадцат*; 18 восемнадцат*; 19 девятнадцат*; 20 двадцат*; 30 тридцат*; 50 пятьдесят*; 100 сто сотн*",
  uk: "1 один одна одне одного; 2 два дві двох двоє; 3 три трьох троє; 4 чотир*; 5 п'ят* пят*; 6 шіст* шест*; 7 сім сем*; 8 вісім восьм*; 9 дев'ят* девят*; 10 десят* десяток* десятк*; 11 одинадцят*; 12 дванадцят*; 20 двадцят*; 30 тридцят*; 50 п'ятдесят*; 100 сто сотн*",
  bg: "1 един една едно еден; 2 два две двама двајца; 3 три трима тројца; 4 четири* четирима четворица; 5 пет*; 6 шест* шестима; 7 седем* седум* седмина; 8 осем* осум* осмина; 9 девет* деветима; 10 десет* десетки*; 11 единадесет* единаесет*; 12 дванадесет* дванаесет*; 20 двадесет* дваесет*; 30 тридесет* триесет*; 50 петдесет* педесет*; 100 сто стотин*",
  sr: "1 један једна једно jedan jedna jedno; 2 два две двоје двојица dva dve dvije dvoje dvojica; 3 три троје тројица tri troje trojica; 4 четири четворо cetiri četiri četvoro cetvoro četvorica četvrt* četver*; 5 пет петоро pet petoro petorica; 6 шест шесторо šest sest šestoro šestorica; 7 седам седморо sedam sedmoro sedmorica; 8 осам осморо osam osmoro osmorica; 9 девет деветоро devet devetoro; 10 десет десеторо deset desetoro desetine* десетине*; 11 једанаест* jedanaest*; 12 дванаест* dvanaest*; 13 trinaest*; 14 četrnaest*; 15 petnaest*; 16 šesnaest*; 17 sedamnaest*; 18 osamnaest*; 19 devetnaest*; 20 двадесет dvadeset*; 30 тридесет trideset*; 50 педесет pedeset*; 100 сто sto stotin*",
  sl: "1 en ena eno; 2 dva dve; 3 tri trije; 4 štiri; 5 pet; 6 šest; 7 sedem; 8 osem; 9 devet; 10 deset; 11 enajst; 12 dvanajst; 20 dvajset; 30 trideset; 50 petdeset; 100 sto",
  cs: "1 jeden jedna jedno; 2 dva dvě dvou; 3 tři tří třem; 4 čtyři čtyř*; 5 pět pěti; 6 šest šesti; 7 sedm sedmi; 8 osm osmi; 9 devět devíti; 10 deset deseti desítk*; 11 jedenáct*; 12 dvanáct*; 20 dvacet*; 30 třicet*; 50 padesát*; 100 sto",
  sk: "1 jeden jedna jedno; 2 dva dve dvoch; 3 tri troch; 4 štyri štyroch; 5 päť piatich; 6 šesť šiestich; 7 sedem siedmich; 8 osem ôsmich; 9 deväť deviatich; 10 desať desiatich desiatk*; 11 jedenásť*; 12 dvanásť*; 20 dvadsať*; 30 tridsať*; 50 päťdesiat*; 100 sto",
  pl: "1 jeden jedna jedno jednego; 2 dwa dwie dwóch dwoje dwaj; 3 trzy trzech troje; 4 cztery czterech czworo; 5 pięć pięciu pięcioro; 6 sześć sześciu; 7 siedem siedmiu; 8 osiem ośmiu; 9 dziewięć dziewięciu; 10 dziesięć dziesięciu dziesiątk*; 11 jedenaście jedenastu; 12 dwanaście dwunastu tuzin*; 13 trzynaś* trzynast*; 14 czternaś* czternast*; 15 piętnaś* piętnast*; 16 szesnaś* szesnast*; 17 siedemnaś* siedemnast*; 18 osiemnaś* osiemnast*; 19 dziewiętnaś* dziewiętnast*; 20 dwadzieścia dwudziestu; 30 trzydzieści trzydziestu; 50 pięćdziesiąt* pięćdziesięciu; 100 sto stu",
  lv: "1 viens viena; 2 divi divas divu diviem; 3 trīs* triju; 4 četr*; 5 piec*; 6 seš*; 7 septiņ*; 8 astoņ*; 9 deviņ*; 10 desmit* desmitiem; 11 vienpadsmit; 12 divpadsmit; 20 divdesmit*; 30 trīsdesmit*; 50 piecdesmit*; 100 simt* simts",
  lt: "1 vienas viena; 2 du dvi dviejų; 3 trys trijų; 4 keturi keturių; 5 penki penkių; 6 šeši šešių; 7 septyni septynių; 8 aštuoni aštuonių; 9 devyni devynių; 10 dešimt*; 11 vienuolika; 12 dvylika; 20 dvidešimt*; 30 trisdešimt*; 50 penkiasdešimt*; 100 šimt*",
  et: "1 üks ühe; 2 kaks kahe; 3 kolm kolme; 4 neli nelja; 5 viis viie; 6 kuus kuue; 7 seitse seitsme; 8 kaheksa*; 9 üheksa*; 10 kümme kümne; 11 üksteist; 12 kaksteist; 20 kakskümmend; 30 kolmkümmend; 50 viiskümmend; 100 sada saja",
  fi: "1 yksi yhden; 2 kaksi kahde* kaht*; 3 kolme kolm*; 4 neljä nelj*; 5 viisi viid* viit*; 6 kuusi kuud* kuut*; 7 seitsemän* seitsem*; 8 kahdeksan* kahdeks*; 9 yhdeksän* yhdeks*; 10 kymmenen* kymmen*; 11 yksitoista; 12 kaksitoista; 20 kaksikymmentä*; 30 kolmekymmentä*; 50 viisikymmentä*; 100 sata sadan",
  hu: "1 egy egyik; 2 kettő két ketten; 3 három* hárm*; 4 négy*; 5 öt öten ötös*; 6 hat haton hatan; 7 hét heten; 8 nyolc*; 9 kilenc*; 10 tíz* tizen*; 11 tizenegy*; 12 tizenkettő* tizenkét; 20 húsz* húszan; 30 harminc*; 50 ötven*; 100 száz*",
  sv: "1 en ett; 2 två; 3 tre; 4 fyra; 5 fem; 6 sex; 7 sju; 8 åtta; 9 nio; 10 tio; 11 elva; 12 tolv dussin*; 20 tjugo*; 30 trettio*; 50 femtio*; 100 hundra*",
  no: "1 en ett ei; 2 to; 3 tre; 4 fire; 5 fem; 6 seks; 7 sju syv; 8 åtte; 9 ni; 10 ti; 11 elleve; 12 tolv dusin*; 20 tjue*; 30 tretti*; 50 femti*; 100 hundre*",
  da: "1 en et; 2 to; 3 tre; 4 fire; 5 fem; 6 seks; 7 syv; 8 otte; 9 ni; 10 ti; 11 elleve; 12 tolv dusin*; 20 tyve*; 30 tredive*; 50 halvtreds*; 100 hundrede*",
  el: "1 ένας ένα μία μια ενός μιας; 2 δύο; 3 τρεις τρία τριών; 4 τέσσερις τέσσερα τεσσάρων; 5 πέντε; 6 έξι; 7 επτά εφτά; 8 οκτώ οχτώ; 9 εννέα εννιά; 10 δέκα δεκάδ*; 11 έντεκα; 12 δώδεκα; 13 δεκατρ*; 14 δεκατέσσ*; 15 δεκαπέντε; 16 δεκαέξι δεκάξι; 17 δεκαεπτά δεκαεφτά; 18 δεκαοκτώ δεκαοχτώ; 19 δεκαεννέα δεκαεννιά; 20 είκοσι; 30 τριάντα; 50 πενήντα; 100 εκατό εκατοντάδ*",
  tr: "1 bir; 2 iki; 3 üç; 4 dört; 5 beş; 6 altı; 7 yedi; 8 sekiz; 9 dokuz; 10 on onlarca; 11 on_bir; 12 on_iki; 20 yirmi*; 30 otuz*; 50 elli*; 100 yüz yüzlerce",
  az: "1 bir; 2 iki; 3 üç; 4 dörd; 5 beş; 6 altı; 7 yeddi; 8 səkkiz; 9 doqquz; 10 on onlarla; 20 iyirmi*; 30 otuz*; 50 əlli*; 100 yüz",
  id: "1 satu; 2 dua; 3 tiga; 4 empat; 5 lima; 6 enam; 7 tujuh; 8 delapan lapan; 9 sembilan; 10 sepuluh puluhan; 11 sebelas; 12 dua_belas lusin; 20 dua_puluh; 30 tiga_puluh; 50 lima_puluh; 100 seratus ratusan",
  tl: "1 isa isang; 2 dalawa dalawang; 3 tatlo tatlong; 4 apat na apat; 5 lima limang; 6 anim na anim; 7 pito pitong; 8 walo walong; 9 siyam na siyam; 10 sampu sampung; 11 labing-isa; 12 labindalawa; 20 dalawampu*; 30 tatlumpu*; 50 limampu*; 100 sandaan isang_daan",
  vi: "1 một; 2 hai; 3 ba; 4 bốn tư; 5 năm; 6 sáu; 7 bảy; 8 tám; 9 chín; 10 mười chục; 11 mười_một; 12 mười_hai; 20 hai_mươi; 30 ba_mươi; 50 năm_mươi; 100 trăm",
  so: "1 kow hal; 2 laba; 3 saddex; 4 afar; 5 shan; 6 lix; 7 toddoba; 8 siddeed; 9 sagaal; 10 toban; 20 labaatan; 30 soddon; 50 konton; 100 boqol",
  sw: "1 moja mmoja; 2 mbili wawili; 3 tatu watatu; 4 nne wanne; 5 tano watano; 6 sita; 7 saba; 8 nane wanane; 9 tisa; 10 kumi; 20 ishirini; 30 thelathini; 50 hamsini; 100 mia",
  sq: "1 një; 2 dy; 3 tre tri; 4 katër; 5 pesë; 6 gjashtë; 7 shtatë; 8 tetë; 9 nëntë; 10 dhjetë; 11 njëmbëdhjetë; 12 dymbëdhjetë; 20 njëzet*; 30 tridhjetë; 50 pesëdhjetë; 100 njëqind qind",
  tet: "1 ida; 2 rua; 3 tolu; 4 haat; 5 lima; 6 neen; 7 hitu; 8 ualu; 9 sia; 10 sanulu; 100 atus",
  mn: "1 нэг; 2 хоёр; 3 гурав гурван; 4 дөрөв дөрвөн; 5 тав таван; 6 зургаа зургаан; 7 долоо долоон; 8 найм найман; 9 ес есөн; 10 арав арван; 20 хорь хорин; 30 гуч гучин; 50 тавь тавин; 100 зуу зуун",
  ar: "1 واحد واحده; 2 اثنان اثنين اثنتين اثنتان; 3 ثلاث; 4 اربع; 5 خمس; 6 ستة ست; 7 سبع; 8 ثماني ثمان; 9 تسع; 10 عشر عشرات; 11 احد_عشر; 12 اثني_عشر اثنا_عشر; 20 عشرين عشرون; 30 ثلاثين ثلاثون; 50 خمسين خمسون; 100 مئه مائه مئات",
  fa: "1 يك; 2 دو; 3 سه; 4 چهار; 5 پنج; 6 شش; 7 هفت; 8 هشت; 9 نه; 10 ده; 11 يازده; 12 دوازده; 20 بيست; 30 سي; 50 پنجاه; 100 صد",
  ur: "1 ايك; 2 دو; 3 تين; 4 چار; 5 پانچ; 6 چھ; 7 سات; 8 آٹھ; 9 نو; 10 دس; 20 بيس; 50 پچاس; 100 سو",
  he: "1 אחד אחת; 2 שניים שתיים שני שתי; 3 שלושה שלוש; 4 ארבעה ארבע; 5 חמישה חמש; 6 שישה שש; 7 שבעה שבע; 8 שמונה; 9 תשעה תשע; 10 עשרה עשר; 20 עשרים; 30 שלושים; 50 חמישים; 100 מאה מאות",
  hi: "1 एक; 2 दो दोनों; 3 तीन; 4 चार; 5 पांच पाँच; 6 छह छः; 7 सात; 8 आठ; 9 नौ; 10 दस; 11 ग्यारह; 12 बारह; 20 बीस; 30 तीस; 50 पचास; 100 सौ",
  ne: "1 एक; 2 दुई; 3 तीन; 4 चार; 5 पाँच पाँचको; 6 छ; 7 सात; 8 आठ; 9 नौ; 10 दश दस; 11 एघार; 12 बाह्र; 20 बीस; 30 तीस; 50 पचास; 100 सय",
  bn: "1 এক; 2 দুই দু; 3 তিন; 4 চার; 5 পাঁচ; 6 ছয়; 7 সাত; 8 আট; 9 নয়; 10 দশ; 11 এগারো; 12 বারো; 20 বিশ; 30 ত্রিশ; 50 পঞ্চাশ; 100 শত একশ",
  th: "1 หนึ่ง; 2 สอง; 3 สาม; 4 สี่; 5 ห้า; 6 หก; 7 เจ็ด; 8 แปด; 9 เก้า; 10 สิบ; 11 สิบเอ็ด; 12 สิบสอง; 20 ยี่สิบ; 30 สามสิบ; 50 ห้าสิบ; 100 ร้อย",
  is: "1 einn ein eitt; 2 tveir tvær tvö; 3 þrír þrjár þrjú; 4 fjórir fjórar fjögur; 5 fimm; 6 sex; 7 sjö; 8 átta; 9 níu; 10 tíu; 11 ellefu; 12 tólf; 20 tuttugu; 100 hundrað*",
  ky: "1 бир; 2 эки; 3 үч; 4 төрт; 5 беш; 6 алты; 7 жети; 8 сегиз; 9 тогуз; 10 он; 20 жыйырма; 100 жүз",
  kk: "1 бір; 2 екі; 3 үш; 4 төрт; 5 бес; 6 алты; 7 жеті; 8 сегіз; 9 тоғыз; 10 он; 20 жиырма; 100 жүз",
  uz: "1 bir; 2 ikki; 3 uch uç; 4 to'rt tört; 5 besh beş; 6 olti; 7 yetti; 8 sakkiz; 9 to'qqiz; 10 o'n; 20 yigirma; 100 yuz",
  tk: "2 iki; 3 üç; 4 dört; 5 bäş; 6 alty; 7 ýedi; 8 sekiz; 9 dokuz; 10 on; 20 ýigrimi; 100 ýüz",
  ka: "2 ორი ორ ორმა; 3 სამი სამ სამმა; 4 ოთხი ოთხ ოთხმა; 5 ხუთი ხუთ; 6 ექვსი ექვს; 7 შვიდი შვიდ; 8 რვა; 9 ცხრა; 10 ათი ათ; 20 ოცი ოც; 100 ასი ას",
  zh: "2 双 雙 俩 倆 两 兩; 3 仨",
  ko: "1 한_명 한명; 2 두_명 두명 둘; 3 세_명 세명 셋; 4 네_명 네명 넷; 5 다섯; 6 여섯; 7 일곱; 8 여덟; 9 아홉; 10 열_명 열명; 20 스무 스물",
};
const parse = (src) => src.split(";").map((p) => p.trim().split(/\s+/)).map(([v, ...w]) => ({ v: +v, st: compile(w.join(" ")) }));
export const NUMBER_WORDS = Object.fromEntries(Object.entries(NUMBER_WORDS_SRC).map(([l, s]) => [l, parse(s)]));
// Without a language tag every language's words are read, except the short ones that are everyday words in other languages
// (Turkish "on", ten, is French "on"; Norwegian "ti", ten, is Italian "ti"), which would let an invented count through.
const AMBIGUOUS = new Set(["on", "ti", "to", "ni", "deu", "ba", "nam", "sau", "hai", "mia", "sei", "set", "sis", "nou", "tu", "hat", "het"]);
const ALL_NUMBER_WORDS = Object.values(NUMBER_WORDS).flat().map(({ v, st }) => ({ v, st: st.filter((x) => x.pre || !AMBIGUOUS.has(x.s)) }));
// the values the original gives as number words: in its own language (and its neighbours'), or in any listed language when the
// language is not known or not listed
export function numberWordValues(orig, lang) {
  const o = fold(orig), out = new Set(), ls = languagesOf(lang, NUMBER_WORDS);
  const table = ls.length ? ls.flatMap((l) => NUMBER_WORDS[l]) : ALL_NUMBER_WORDS;
  for (const { v, st } of table) if (!out.has(v) && st.some((x) => hasStem(o, x))) out.add(v);
  return out;
}

// English: a count of people next to what happened to them. "10 killed", "Kill 10", "killing at least 10", "death toll rises
// to 10", "Three people died", "10 others were injured", "5 arrested".
const EN_NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100 };
const NUM = "(\\d+(?:,\\d{3})*(?:\\.\\d+)?|(?:" + Object.keys(EN_NUM_WORDS).join("|") + ")(?![a-z]))";
const WHAT = "(?:kill(?:s|ed|ing)?|dead|deaths?|died|dies|dying|wounded|wounding|injur(?:ed|ies|y|ing|es)|hurt|casualt(?:y|ies)|fatalit(?:y|ies)|slain|" +
  "victims|bodies|missing|arrest(?:s|ed)?|detain(?:s|ed)?|abduct(?:s|ed)?|kidnap(?:s|ped)?|hostages?|executed|murdered|shot)";
const WHO = "(?:people|persons?|civilians?|soldiers?|troops|children|kids|students|women|men|police(?:men)?|officers?|militants?|fighters?|" +
  "workers?|miners?|migrants?|passengers?|pilgrims?|protesters?|suspects?|others?|more|are|were|was|is|have|has|been|reported(?:ly)?|confirmed|feared|believed|" +
  "now|so far|at least|including|of them|in all|in total|left|were left|and)";
const COUNT_BEFORE = new RegExp("(?<![\\w.,])" + NUM + "(?:\\s+" + WHO + "){0,3}\\s+" + WHAT + "\\b", "gi");
const COUNT_AFTER = new RegExp("\\b" + WHAT + "(?:\\s+(?:at least|nearly|almost|about|around|over|more than|up to|some|another|rises? to|rose to|climbs? to|climbed to|" +
  "reaches|reached|hits|jumps? to|of|to|is|now|stands at|toll(?: rises to| at| of)?)){0,3}\\s+" + NUM + "(?![\\d%,.]?\\d)(?!\\s*(?:%|percent|per cent|years?|days?|hours?|km|kilomet))", "gi");
// thousands written as a word after the digits: "74 mil 594" (74,594), "2 tys.", "5 тыс.", "3 bin", "10 ribu", "4 ألف"
const THOUSAND = /(\d+)\s*(?:mil|mille|mila|tys\.?|тыс\.?|тис\.?|хиљ\p{L}*|hiljad\p{L}*|bin|ribu|nghìn|ngàn|ألف|الف|آلاف)(?:\s+(\d{1,3})(?!\d))?/giu;
function thousands(orig) {
  const out = new Set();
  for (const m of String(orig || "").normalize("NFKC").matchAll(THOUSAND)) out.add(+m[1] * 1000 + (m[2] ? +m[2] : 0)).add(+m[1] * 1000);
  return out;
}
export function extraCount(orig, en, inOrig, lang) {
  en = String(en || "");
  const words = numberWordValues(orig, lang);
  for (const v of thousands(orig)) words.add(v);
  for (const re of [COUNT_BEFORE, COUNT_AFTER]) for (const m of en.matchAll(re)) {
    const w = m[1].toLowerCase(), v = EN_NUM_WORDS[w] || +w.replace(/,/g, "");
    // one: a singular ("قتيل", a dead man; "Toter") is "one dead" or "1 dead" in English as often as not
    if (!Number.isFinite(v) || v <= 1 || (v >= 1900 && v <= 2100 && /^\d{4}$/.test(w))) continue;
    if (words.has(v) || inOrig(v)) continue;
    // Arabic and Hebrew say two with the noun's own ending ("امرأتين", two women), not a number word
    if (v === 2 && /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(orig)) continue;
    return m[1];
  }
  return "";
}

// Words for death, killing and injury in the original's language. The English may say people were killed or hurt only when the
// original has one of these; a language that is not listed is not judged.
const HARM_SRC = {
  de: "gefallen* tot tote toten toter totes getötet* tötet* töten* tödlich* sterb* starb* gestorben* verletz* opfer* leiche* mord* ermord* umgekommen* todes* tod ums_leben verwundet* massaker* hinricht*",
  nl: "liquid* geliquideerd* dood doden dode gedood* doodt* omgekomen* om_het_leven gewond* slachtoffer* moord* vermoord* sterft* stierf* stierven* overled* lichaam* lijk* gesneuveld* bloedbad*",
  fr: "meurt* meurent* lésion* mort* tué* tue tuent* tuant* décès décéd* blessé* blessant* victime* meurtr* assassin* cadavre* corps bilan péri* succomb* la_vie massacr* exécut* tuerie*",
  es: "abat* herir* hiere* hirió* muri* lesion* lesión* muert* muer* mata* matan* mató* asesin* herid* víctima* falleci* falleció* fallecen* cadáver* cuerpo* homicid* saldo fatal* sin_vida masacre* ejecut* mortal*",
  pt: "lesão* lesao* mort* morre* morreu* morrem* matou* mata* matam* ferid* vítima* falec* assassin* cadáver* corpo* homicíd* sem_vida massacre* fatal* execut* chacina*",
  it: "lesion* mort* muor* uccis* ucci* uccid* ferit* vittim* deced* cadaver* corpo* omicid* strage* massacr* giustiziat* sangue",
  ca: "ferid* morí* moria* mort* morir* mor moren ferit* víctim* assassin* cadàver* homicid*",
  ro: "moart* ucid* mort* decedat* deces* ucis* ucide* rănit* ranit* victim* cadavr* cadavru* omor* murit* moare* crim* masacr* execut*",
  ru: "травм* насмерть убийств* убит* убив* убил* убий* погиб* гибел* смерт* умер* умир* ранен* ранил* раним* жертв* тел* тело* мертв* скончал* пострадав* пострадал* казн* расстрел* бойн*",
  uk: "травм* насмерть вбит* вбив* вбил* вбивств* загин* загибл* смерт* помер* поранен* ранен* жертв* тіл* тіло* мертв* постраждал* страт* розстріл*",
  bg: "травм* издъхн* уби* рани* убийств* насмърт* убит* убива* убий* загина* загинал* загиналите смърт* почина* ранен* ранени* жертв* мъртв* пострада* тел* тяло*",
  mk: "мртов* угина* травм* убиств* убиени уби* ранет* рани* повред* убиен* убиј* убива* загина* загинал* смрт* почина* ранет* повреден* жртв* мртв* тело* тела",
  sr: "premin* преминуо* травм* traum* убијен* убиј* убио* убила* убиство* погин* смрт* умр* рањен* повређен* жртв* мртв* страда* тел* ubij* ubio ubila ubili ubistv* pogin* smrt* umr* ranjen* povrijeđ* povređ* ozlijeđ* žrtv* mrtv* strada* tijel* telo* tela leš* masakr*",
  hr: "premin* ubij* ubio ubila ubili ubistv* ubojstv* pogin* smrt* umr* ranjen* povrijeđ* ozlijeđ* žrtv* mrtv* strada* tijel* leš* masakr*",
  bs: "premin* ubij* ubio ubila ubili ubistv* pogin* smrt* umr* ranjen* povrijeđ* povređ* žrtv* mrtv* strada* tijel* leš* masakr*",
  sl: "ubit* ubil* ubij* umrl* umr* smrt* mrtv* ranjen* poškodov* žrtev* žrtv* trupl* pokol*",
  cs: "úraz* zabit* zabil* zabij* zemřel* zemř* umřel* smrt* mrtv* zraněn* zranil* oběť* obět* usmrt* zahyn* přežil* nepřežil* tělo* těl* masakr* vraž*",
  sk: "úraz* zabit* zabil* zabij* zomrel* zomr* smrť* smrt* mŕtv* mrtv* zranen* zranil* obeť* obet* usmrt* zahyn* telo* tiel* masaker* vraž*",
  pl: "zabój* zabojstw* nie_żyj* zabit* zabił* zabij* zgin* śmier* śmiert* zmarł* zmarl* umarł* rann* zranion* zranił* ofiar* zwłok* ciał* masakr* mord* zamord* poszkodow*",
  lv: "nogalin* bojā bojāgāj* gāja_bojā miris mirus* mirušo mirušie mira mirst* nāv* ievainot* ievainoj* cietuš* cietis upur* līķ* slepkav* asinspirt*",
  lt: "nukentėj* žudy* žuv* žuvo nužud* mirt* mirė mir* sužeist* sužeid* auk* kūn* žudyn* nušov*",
  et: "viga_saa* hukk* surm* sur* tapet* tapp* vigast* ohv* laip* haavat*",
  fi: "kuol* tapp* tapet* surm* haavoitt* loukkaant* uhr* ruumi* menehty* verilöyly*",
  hu: "halott* halál* meghal* meghalt* megöl* megsebes* sérül* sebes* áldozat* holttest* elhuny* gyilkos* életét életüket lelőtt* mészárl*",
  sv: "ihjäl död* dödad* dödade dödas dödar dog omkom* skadad* skadade skadas offer* mord* mörd* kropp* livet massaker* skjuten skjutna",
  no: "avliv* død* drept* drap* omkom* skadet* såret* offer* mord* livet lik massakr* skutt*",
  da: "kvæst* aflive* død* dræbt* dræb* drab* omkom* såret* sårede skadet* offer* ofre mord* livet lig massakr* skudt*",
  el: "κτον* φόν* φον* θανάσιμ* νεκρ* σκοτώ* σκοτω* σκότω* θάνατ* θανατ* πέθαν* πεθαί* τραυματ* θύμα* θυμάτ* πτώμ* σορ* δολοφον* χάνουν χάθηκ* ζωή* ζωής σφαγ* εκτέλεσ* πολύνεκρ*",
  tr: "ölü* öldü* ölüm* öldür* ölen* öl yaralı* yaralan* hayatını hayatını_kaybet* can_kayb* cenaze* ceset* şehit* kurban* cinayet* katled* vefat* katliam* infaz*",
  az: "ölən* öldürül* ölü* öldü* ölüm* öldür* yaralı* yaralan* həlak* həyatını şəhid* qurban* cəsəd* qətl* vəfat*",
  id: "nyawa habisi* tewas* meninggal* mati kematian korban* bunuh* terbunuh* jenazah* mayat* maut* jiwa luka* lukai terluka* gugur* tembak_mati pembunuhan* pembantaian* eksekusi*",
  ms: "maut* terbunuh* bunuh* meninggal* mati kematian korban* mangsa* mayat* jenazah* cedera* luka* parah* terkorban* pembunuhan*",
  tl: "patay* napatay* pinatay* nasawi* sugatan* sugat* biktima* bangkay* nasugatan* pinaslang* buhay* namatay* pumanaw* nakitil*",
  vi: "ngưng_tim tử_vong qua_đời chết* thiệt_mạng tử_vong bị_thương giết* sát_hại thương_vong nạn_nhân thi_thể xác* tử_nạn hy_sinh tử_thương thảm_sát mất_tích tử_hình",
  so: "dhint* dil* dilay* dilka* dhaawac* geeri* geeriyoo* mayd* khasaar* naf* dhimasho* toogt*",
  sw: "yaua kuua uaw* kufa* fariki* waliofariki* uawa* kuuawa* wameuawa* waliouawa* majeruhi* jeruhi* jeruhiwa* mauaji* vifo* kifo* mwili* miili* wauawa* waliokufa* walikufa*",
  sq: "vrit* vrau vras* vdekj* vdekur* vdes* vdiq* vran* vrarë* vrari* vrasje* plagos* plagë* plagu* viktim* kufom* trup* jetën humb* masakr*",
  ar: "مجزر قضوا قضي لقوا خسائر بحياه حياه فقيد اوده اباده ميت استشهاد قتل قتيل قتلي مقتل اقتل يقتل تقتل وفاه وفي توفي مصرع حتف جرح جريح جرحي اصاب مصاب مصابين ضحايا ضحيه شهيد شهداء استشهد موت مات يموت جثه جثث جثمان اغتيال حصيله دامي مجزره اعدام هلاك",
  fa: "درگذشت* درگذشته كشته كشت قتل مرگ فوت زخمي مجروح مصدوم جان_باخت جان_سپرد جان_داد قرباني جسد اجساد شهيد شهادت جان كشتار اعدام هلاك تلفات",
  ur: "ہلاک ہلاکت جاں_بحق جان قتل موت زخمي شہيد لاش جان_بحق جاں ہلاکتيں مارے",
  he: "נהרג הרוג נרצח רצח מת מתו פצוע נפצע פצועים קורבן חלל חללים גופה גופות הרג מוות נספה נספו טבח",
  hi: "मौत मौतें मृत मृतक मारे मार हत्या घायल जख्मी ज़ख्मी शव लाश जान निधन शहीद हताहत मरे मरने दम_तोड़ जानलेवा फांसी",
  ne: "मृत्यु मृत मारिए मारिय मारि मार हत्या घाइते घायल शव ज्यान निधन ज्यान_गुमाए मरे",
  bn: "খুন নিহত মৃত মৃত্যু আহত হত্যা খুন লাশ প্রাণ হতাহত মারা মরদেহ জখম গুলিবিদ্ধ",
  si: "මිය මරණ මරා තුවාල ඝාතන මළ සිරුර ජීවිත",
  th: "อาลัย มรณภาพ ตาย เสียชีวิต บาดเจ็บ เจ็บ ดับ สังหาร ฆ่า ศพ ยิง สิ้นใจ เหยื่อ ชีวิต สูญหาย ปลิดชีพ ถูกยิง สาหัส มรณะ ประหาร",
  km: "ស្លាប់ របួស សម្លាប់ សាកសព ជនរងគ្រោះ បាត់បង់ជីវិត",
  lo: "ເສຍຊີວິດ ຕາຍ ບາດເຈັບ ຂ້າ ສົບ",
  my: "သေဆုံး ဒဏ်ရာ သတ် အလောင်း သေ",
  zh: "逝 離世 离世 ohca 墜 坠 砍 凶 命案 刺 枪击 槍擊 死 亡 伤 傷 杀 殺 遇难 遇難 罹难 罹難 丧生 喪生 尸 屍 遗体 遺體 身亡 毙 斃 害 命 血",
  ja: "心停止 遺骨 逝 ohca 死 亡 負傷 傷 殺 けが 怪我 遺体 犠牲 重体 心肺停止 命 惨事 被害",
  ko: "추락사 사산 참변 심정지 폐사 순직 별세 살인 사고사 타계 영면 사망 숨져 숨진 숨지 숨졌 부상 다쳐 다친 다쳤 살해 죽 사상 희생 시신 사상자 피살 중상 경상 사살 인명 숨 참사 유해 변사 사체 피해",
  mn: "хөнөө* ами* нас_бар* амь* үх* шарх* гэмт* хохир* ал* амиа* цогцос*",
  ka: "ჩაცხრილ* დახოც* მკვლელ* დაიღუპ* მოკლ* დაჭრ* გარდაიცვალ* მსხვერპლ* ცხედარ* სიკვდილ* დაშავ* ტრაგედი*",
  hy: "տուժ* զոհ* սպան* մահ* վիրավոր* մահաց* դի* վնասվածք*",
  am: "ገደል ገደሉ ተገደ መገደ ሞቱ ሞተ ሞት ተገደሉ ተገደለ ቆሰሉ ቆሰለ ገደለ አስከሬን ቁስለኛ ህይወታቸው ሕይወታቸው ህልፈት ሞቷል",
  tet: "mate* oho* kanek* terus* sobu* masakre* massacre*",
  be: "забіт* забіў* загін* загіб* смерц* памёр* памер* паранен* ранен* траўм* ахвяр* цел* насмерць",
  ky: "өл* өлт* жараат* каза* курман* сөөк* жаракат*",
  kk: "қаза* өл* жарақат* өлтір* құрбан* мәйіт*",
  tg: "кушт* захм* фавт* ҳалок* марг* ҷон* қурбон*",
  ps: "مړه مړ وژل وژن ټپي زخمي ووژل قتل مرګ",
};
export const HARM_STEMS = Object.fromEntries(Object.entries(HARM_SRC).map(([l, s]) => [l, compile(s)]));
// a language tag ("pt-BR", "sr-Latn") to its HARM_STEMS key; Malay and Indonesian, and the Serbo-Croatian languages, read each other's words
const ALIAS = { ms: ["ms", "id"], id: ["id", "ms"], sr: ["sr", "hr", "bs"], hr: ["hr", "sr", "bs"], bs: ["bs", "sr", "hr"], cnr: ["sr", "hr", "bs"], me: ["sr", "hr", "bs"],
  sh: ["sr", "hr", "bs"], mk: ["mk", "bg", "sr"], bg: ["bg", "mk", "ru"], nb: ["no", "da", "sv"], nn: ["no", "da", "sv"], no: ["no", "da", "sv"], da: ["da", "no", "sv"], sv: ["sv", "no", "da"],
  fil: ["tl"], tl: ["tl"], "zh-hant": ["zh", "ja"], zh: ["zh", "ja"], ja: ["ja", "zh"], ur: ["ur", "fa", "ar"], fa: ["fa", "ar"], ps: ["ps", "fa", "ur", "ar"], ku: [], ckb: [],
  ar: ["ar"], uk: ["uk", "ru"], ru: ["ru", "uk"], be: ["be", "ru", "uk"], ca: ["ca", "es", "fr"], gl: ["es", "pt"], ne: ["ne", "hi"], hi: ["hi", "ne"], mr: ["hi", "ne"] };
// without a language tag the script decides which languages' words are read; Latin script is too widely shared to judge
const SCRIPTS = [[/\p{Script=Cyrillic}/u, ["ru", "uk", "be", "bg", "mk", "sr", "mn", "ky", "kk", "tg"]], [/\p{Script=Greek}/u, ["el"]], [/\p{Script=Arabic}/u, ["ar", "fa", "ur", "ps"]],
  [/\p{Script=Hebrew}/u, ["he"]], [/\p{Script=Thai}/u, ["th"]], [/\p{Script=Hangul}/u, ["ko"]], [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, ["ja", "zh"]],
  [/\p{Script=Han}/u, ["zh", "ja"]], [/\p{Script=Devanagari}/u, ["hi", "ne"]], [/\p{Script=Bengali}/u, ["bn"]], [/\p{Script=Georgian}/u, ["ka"]],
  [/\p{Script=Armenian}/u, ["hy"]], [/\p{Script=Ethiopic}/u, ["am"]], [/\p{Script=Khmer}/u, ["km"]], [/\p{Script=Lao}/u, ["lo"]], [/\p{Script=Myanmar}/u, ["my"]], [/\p{Script=Sinhala}/u, ["si"]]];
function languagesOf(lang, table) {
  const l = String(lang || "").toLowerCase().replace(/_/g, "-"), base = l.split("-")[0];
  return (ALIAS[l] || ALIAS[base] || [base]).filter((x) => table[x]);
}
export function harmLanguages(orig, lang) {
  if (lang) return languagesOf(lang, HARM_STEMS);
  const s = SCRIPTS.find(([re]) => re.test(orig));
  return s ? s[1] : [];
}
export const EN_HARM = /\b(kill(?:s|ed|ing)?|dead|deaths?|died|dies|dying|wounded|wounding|injur(?:ed|ies|y|ing|es)|casualt(?:y|ies)|fatalit(?:y|ies)|slain|death toll|murder(?:s|ed)?|massacre[sd]?)\b/i;
// "dead" and "death" in names and set phrases that say nothing about a casualty
const EN_HARM_IDIOM = /\b(?:dead\s*(?:line|lock|sea|end|heat|ly)|death\s*(?:penalty|sentence|row|metal|star)|(?:sudden|brain)\s+death|killer\s+app|kill\s+switch|injury\s+time|black\s+death)\b/gi;
export function extraHarm(orig, en, lang) {
  en = String(en || "").replace(EN_HARM_IDIOM, " ");
  const m = en.match(EN_HARM);
  if (!m) return "";
  const langs = harmLanguages(String(orig || ""), lang);
  if (!langs.length) return "";
  // Bangladeshi outlets break up such words ("হ’ত্যা", "হ-ত্যা"); the marks inside a word are read through
  const o = fold(orig).replace(/(?<=\p{L})[-'’‘*.](?=\p{L})/gu, "");
  // text with broken characters is not judged
  if (o.includes("�")) return "";
  // the English word in the original itself (an English title under another language's label, a song called "Looks Can Kill")
  if (o.includes(fold(m[1]).replace(/(?:s|ed|ing|es)$/, ""))) return "";
  // a stem may sit inside a word ("Körperverletzung", "Decembermoorden", "насмерть"): read anywhere, it can only accept a line
  for (const l of langs) if (HARM_STEMS[l].some((st) => hasStem(o, st, true))) return "";
  return m[1];
}
