// Month names in the languages OSAP reads, for tools/mt_guard.mjs (a month the English names must be one the original gives).
// Stems, lowercase; a Latin, Cyrillic or Greek stem must start a word, others may follow a prefix (Arabic بـ, Amharic የ).
// Calendars whose months straddle two Gregorian ones (Nepali Bikram Sambat, Ethiopian, Persian and Afghan solar) count for both.
// month index -> stems in many languages (lowercase). Matched where no letter precedes.
export const MONTHS = [
 /*1*/ "jan janv enero ene. gennaio janeiro ianuarie gener januar januari janvāris sausis tammikuu jaanuar styczeń stycz leden január siječanj sijeca január januára január janar ιανου январ січ яну ocak yanvar januari enero tháng một มกรา ม.ค. ມັງກອນ មករា ဇန်နဝါရီ يناير كانون الثاني ژانویه ינואר जनवरी জানুয়ারি ජනවාරි იანვ հունվ ጥር ጃንዩ januari januar janvier januarie ianuar jänner zan janoary janari janvye ጥሪ",
 /*2*/ "feb fév févr febrero febbraio fevereiro februarie febrer februar februari februāris vasaris helmikuu veebruar luty luteg únor február veljača februar shkurt φεβρ феврал лют фев şubat fevral pebrero tháng hai กุมภา ก.พ. ກຸມພາ កុម្ភៈ ဖေဖော်ဝါရီ فبراير شباط فوریه פברואר फरवरी ফেব্রুয়ারি පෙබරවාරි თებ փետր የካቲት ፌብሩ februari fevrye febroary",
 /*3*/ "mar mars marzo março martie març märz maart marts mars marts mart kovo maaliskuu märts marzec marz březen marec ožujak mart mars μαρτ март берез мар mart mart marso tháng ba มีนา มี.ค. ມີນາ មីនា မတ် مارس آذار مارس מרץ मार्च মার্চ මාර්තු მარ մարտ መጋቢት ማርች maachi marsa machi",
 /*4*/ "apr avr avril abril aprile aprilie abril april april april apríl aprīlis balandis huhtikuu aprill kwiecień kwiec duben apríl travanj april prill απρ апрел квіт апр nisan aprel abril tháng tư เมษา เม.ย. ເມສາ មេសា ဧပြီ أبريل ابريل نيسان آوریل אפריל अप्रैल এপ্রিল අප්‍රේල් აპრ ապրիլ ሚያዝያ ኤፕሪ aprili aprily avril",
 /*5*/ "may mai mayo maggio maio mai maig mai mei maj maijs gegužė toukokuu mai maj květen máj svibanj maj maj μαΐ μαι май трав мая mayıs may mayo tháng năm พฤษภา พ.ค. ພຶດສະພາ ឧសភា မေ مايو أيار ايار مه מאי मई মে මැයි მაის մայիս ግንቦት ሜይ mei mey me",
 /*6*/ "jun juin junio giugno junho iunie juny juni juni jūnijs birželis kesäkuu juuni czerwiec czerw červen jún lipanj jun qershor ιουν июн черв юни haziran iyun hunyo tháng sáu มิถุนา มิ.ย. ມິຖຸນາ មិថុនា ဇွန် يونيو حزيران ژوئن יוני जून জুন ජූනි ივნ հունիս ሰኔ ጁን juni jiyen jona",
 /*7*/ "jul juil juillet julio luglio julho iulie juliol juli juli jūlijs liepa heinäkuu juuli lipiec lip červenec júl srpanj jul korrik ιουλ июл лип юли temmuz iyul hulyo tháng bảy กรกฎา ก.ค. ກໍລະກົດ កក្កដា ဇူလိုင် يوليو تموز ژوئیه יולי जुलाई জুলাই ජූලි ივლ հուլիս ሐምሌ ጁላ julai jiyè jolay",
 /*8*/ "aug août agosto agosto agosto august agost august augustus august augusts rugpjūtis elokuu august sierpień sierp srpen august kolovoz avgust gusht αυγ август серп авг ağustos avqust agosto tháng tám สิงหา ส.ค. ສິງຫາ សីហា ဩဂုတ် أغسطس اغسطس آب اوت אוגוסט अगस्त আগস্ট අගෝස්තු აგვ օգոստ ነሐሴ ኦገስ agosti dawou aogositra",
 /*9*/ "sep sept septembre septiembre settembre setembro septembrie setembre september september september septembris rugsėjis syyskuu september wrzesień wrzes září september rujan septembar shtator σεπτ сентябр верес сеп сен eylül sentyabr setyembre tháng chín กันยา ก.ย. ກັນຍາ កញ្ញា စက်တင်ဘာ سبتمبر أيلول ايلول سپتامبر ספטמבר सितंबर सितम्बर সেপ্টেম্বর සැප්තැම්බර් სექ սեպտ መስከረም ሴፕቴ septemba septanm septambra",
 /*10*/ "oct octobre octubre ottobre outubro octombrie octubre oktober oktober oktober október oktobris spalis lokakuu oktoober październik pazdz říjen október listopad oktobar tetor οκτ октябр жовт окт ekim oktyabr oktubre tháng mười ตุลา ต.ค. ຕຸລາ តុលា အောက်တိုဘာ أكتوبر اكتوبر تشرين الأول اکتبر אוקטובר अक्टूबर অক্টোবর ඔක්තෝබර් ოქტ հոկտ ጥቅምት ኦክቶ oktoba oktòb oktobra",
 /*11*/ "nov novembre noviembre novembre novembro noiembrie novembre november november november november novembris lapkritis marraskuu november listopad listop listopad november studeni novembar nëntor νοεμ ноябр листоп ноем ноя kasım noyabr nobyembre tháng mười một พฤศจิกา พ.ย. ພະຈິກ វិច្ឆិកា နိုဝင်ဘာ نوفمبر تشرين الثاني نوامبر נובמבר नवंबर नवम्बर নভেম্বর නොවැම්බර් ნოემ նոյեմ ኅዳር ህዳር ኖቬም novemba novanm novambra",
 /*12*/ "dec déc décembre diciembre dicembre dezembro decembrie desembre dezember december december december decembris gruodis joulukuu detsember grudzień grudz prosinec december prosinac decembar dhjetor δεκ декабр груд дек aralık dekabr disyembre tháng mười hai ธันวา ธ.ค. ທັນວາ ធ្នូ ဒီဇင်ဘာ ديسمبر كانون الأول دسامبر דצמבר दिसंबर दिसम्बर ডিসেম্বর දෙසැම්බර් დეკ դեկտ ታኅሣሥ ታህሳስ ዲሴም desemba desanm desambra",
].map((s) => s.split(" ").filter(Boolean));
const ADD = [   // more stems and inflections (Tetum, Maltese, Kazakh, Mongolian, Lithuanian, Croatian, Urdu, Dhivehi, Filipino ...)
 "janei jannar siječ جنوری ޖަނަވަރީ қаңтар нэгдүгээр сар sausi ene. ene enr.",
 "fever frar veljač فروری ފެބުރުއަރީ ақпан хоёрдугаар сар vasar peb.",
 "marzu ožuj مارچ މާރިޗު наурыз гуравдугаар сар kov",
 "abril travn travanj اپریل އެޕްރީލް сәуір дөрөвдүгээр сар baland abr.",
 "maiu mejju svib مئی މެއި мај мамыр тавдугаар сар geguž",
 "juñu junhu lipn lipanj ޖޫން ġunju маусым зургаадугаар сар biržel hun.",
 "jullu lulju srpn srpanj جولائی ޖުލައި шілде долдугаар сар liep hul.",
 "agost awwissu kolovoz اگست އޮގަސްޓު тамыз наймдугаар сар rugpjū ago.",
 "setemb settembru rujn rujan ستمبر ސެޕްޓެމްބަރު қыркүйек есдүгээр сар rugsėj set.",
 "outub ottub oktoob oktabr oktýabr كتوبر اکتوبر listopad އޮކްޓޯބަރު oktob oktòb қазан аравдугаар сар spal okt.",
 "novemb novanm studen nentor noýabr نومبر ނޮވެމްބަރު ނޮވެންބަރު қараша арван нэгдүгээр сар lapkri nob.",
 "dezemb diċembru prosin dekabr دسمبر ޑިސެމްބަރު desanm желтоқсан арван хоёрдугаар сар gruod dis.",
];
ADD.forEach((s, i) => MONTHS[i].push(...s.split(" ").filter(Boolean)));
["јануар januari","фебруар februari","март mac","април april","мај mei","јуни jun","јули julai","август ogos","септемв september","октомв oktober","ноемв november","декемв disember"].forEach((s, i) => MONTHS[i].push(...s.split(" ")));   // Macedonian and Serbian Cyrillic, Malay
["يناير janúar mutarama ýanwar ianuari","فبراير febrúar gashyantare fewral fepuari","maret mars werurwe mart mati machi","أبريل apríl mata aprel aperila aprili","ماي maí gicurasi maý me mei","يونيو júní kamena iýun iuni juni","يوليوز júlí nyakanga iýul iulai julai","غشت agustus ágúst kanama awgust aukuso agosti","setiem شتنبر nzeri sentýabr setema septemba","október ukwakira oktýabr oketopa oktoba","noiem نونبر nóvember ugushyingo noýabr novema novemba","desember دجنبر ukuboza dekabr tesema desemba"].forEach((s, i) => MONTHS[i].push(...s.split(" ")));   // Spanish (Peru), Maghreb Arabic, Indonesian, Icelandic, Kinyarwanda, Turkmen, Samoan, Swahili
// calendars whose months straddle two Gregorian ones: Bikram Sambat (Nepali), Ethiopian, Persian and Afghan solar
const TWO = [
 ["बैशाख वैशाख", 4], ["जेठ जेष्ठ", 5], ["असार आषाढ", 6], ["साउन श्रावण", 7], ["भदौ भाद्र", 8], ["असोज आश्विन", 9], ["कार्तिक कात्तिक", 10],
 ["मंसिर मङ्सिर मार्गशीर्ष", 11], ["पुस पौष", 12], ["माघ", 1], ["फागुन फाल्गुन", 2], ["चैत चैत्र", 3],
 ["መስከረም", 9], ["ጥቅምት", 10], ["ኅዳር ህዳር", 11], ["ታኅሣሥ ታህሳስ", 12], ["ጥር", 1], ["የካቲት", 2], ["መጋቢት", 3], ["ሚያዝያ", 4], ["ግንቦት", 5], ["ሰኔ", 6], ["ሐምሌ", 7], ["ነሐሴ", 8],
 ["فروردین حمل", 3], ["اردیبهشت ثور", 4], ["خرداد جوزا", 5], ["تیر سرطان", 6], ["مرداد اسد", 7], ["شهریور سنبله", 8], ["مهر میزان", 9], ["آبان عقرب", 10],
 ["آذر قوس", 11], ["دی جدی", 12], ["بهمن دلو", 1], ["اسفند حوت", 2],
];
for (const [s, m] of TWO) for (const k of [m, m % 12 + 1]) MONTHS[k - 1].push(...s.split(" "));
