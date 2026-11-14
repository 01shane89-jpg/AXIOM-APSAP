// Probe: national news RSS candidates for US and other large countries (14 Nov 2026). Plain OSAP UA, no spoofing.
const UA = "AXIOM-OSAP/1.0 (open-source situational awareness; +https://01shane89-jpg.github.io/AXIOM-APSAP/)";
const C = `us|CNN US|http://rss.cnn.com/rss/cnn_us.rss
us|CNN Top|http://rss.cnn.com/rss/cnn_topstories.rss
us|CNN Lite|https://lite.cnn.com/
us|ABC News Top|https://abcnews.go.com/abcnews/topstories
us|ABC7 LA|https://abc7.com/feed/
us|ABC7 NY|https://abc7ny.com/feed/
us|ABC7 Chicago|https://abc7chicago.com/feed/
us|ABC7 SF|https://abc7news.com/feed/
us|CBS Latest|https://www.cbsnews.com/latest/rss/main
us|CBS US|https://www.cbsnews.com/latest/rss/us
us|NBC Top|https://feeds.nbcnews.com/nbcnews/public/news
us|NBC US|https://feeds.nbcnews.com/nbcnews/public/us-news
us|Fox Latest|https://moxie.foxnews.com/google-publisher/latest.xml
us|Fox US|https://moxie.foxnews.com/google-publisher/us.xml
us|AP Top|https://apnews.com/index.rss
us|AP hub|https://apnews.com/hub/ap-top-news.rss
us|USA Today|https://rssfeeds.usatoday.com/usatoday-NewsTopStories
us|USA Today 2|https://www.usatoday.com/news/nation/rss/
us|CNBC Top|https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114
us|Newsweek|https://www.newsweek.com/rss
us|NY Post|https://nypost.com/news/feed/
us|Time|https://time.com/feed/
us|WSJ US|https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml
us|Bloomberg Politics|https://feeds.bloomberg.com/politics/news.rss
us|Stars and Stripes|https://www.stripes.com/feeds/rss
us|Defense One|https://www.defenseone.com/rss/all/
us|Breaking Defense|https://breakingdefense.com/feed/
us|DefenseScoop|https://defensescoop.com/feed/
us|The Independent US|https://www.independent.co.uk/news/world/americas/rss
us|UPI Top|https://rss.upi.com/news/top_news.rss
us|CBS Live|https://www.cbsnews.com/live-updates/rss/
us|NBC Live|https://www.nbcnews.com/live-updates/rss
us|NewsHour live|https://www.pbs.org/newshour/feeds/rss/headlines
us|CNN live|https://www.cnn.com/live-news/rss
us|Washington Examiner|https://www.washingtonexaminer.com/feed/
us|Reuters US|https://www.reuters.com/arc/outboundfeeds/news-sitemap/?outputType=xml
us|FAA newsroom|https://www.faa.gov/newsroom/rss
us|DHS news|https://www.dhs.gov/news-releases/rss.xml
gb|ITV News|https://www.itv.com/news/rss
gb|Telegraph|https://www.telegraph.co.uk/rss.xml
gb|Evening Standard|https://www.standard.co.uk/rss
gb|inews|https://inews.co.uk/feed
gb|Daily Mirror news|https://www.mirror.co.uk/news/?service=rss
gb|Channel 4 News|https://www.channel4.com/news/feed
gb|Forces News|https://www.forcesnews.com/rss.xml
gb|GOV.UK news|https://www.gov.uk/search/news-and-communications.atom
de|Spiegel|https://www.spiegel.de/schlagzeilen/index.rss
de|Zeit|https://newsfeed.zeit.de/index
de|Süddeutsche|https://rss.sueddeutsche.de/rss/Topthemen
de|n-tv|https://www.n-tv.de/rss
de|Welt|https://www.welt.de/feeds/latest.rss
de|BR24|https://www.br.de/nachrichten/meldungen/rss
fr|Le Parisien|https://feeds.leparisien.fr/leparisien/rss
fr|20 Minutes|https://www.20minutes.fr/feeds/rss-une.xml
fr|BFMTV|https://www.bfmtv.com/rss/news-24-7/
fr|Le Monde FR|https://www.lemonde.fr/rss/une.xml
fr|Franceinfo une|https://www.francetvinfo.fr/titres.rss
ca|CTV News|https://www.ctvnews.ca/rss/ctvnews-ca-top-stories-public-rss-1.822009
ca|Toronto Star|https://www.thestar.com/search/?f=rss&t=article&c=news*&l=50&s=start_time&sd=desc
ca|Globe and Mail|https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/canada/
ca|CBC Top|https://www.cbc.ca/webfeed/rss/rss-topstories
ca|The Canadian Press|https://www.thecanadianpressnews.ca/search/?f=rss&t=article&l=50&s=start_time&sd=desc
ru|Kommersant|https://www.kommersant.ru/RSS/news.xml
ru|RIA|https://ria.ru/export/rss2/archive/index.xml
ru|Interfax|https://www.interfax.ru/rss.asp
ru|Meduza RU|https://meduza.io/rss/all
ua|Suspilne|https://suspilne.media/rss/all.rss
ua|RBC-Ukraine|https://www.rbc.ua/static/rss/all.rus.rss.xml
ua|Kyiv Independent|https://kyivindependent.com/news-archive/rss/
ua|Ukrainska Pravda UA|https://www.pravda.com.ua/rss/view_news/
es|RTVE|https://api2.rtve.es/rss/temas_noticias.xml
es|ABC.es|https://www.abc.es/rss/2.0/portada/
es|La Vanguardia|https://www.lavanguardia.com/rss/home.xml
br|Estadão|https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/politica/
br|UOL|https://rss.uol.com.br/feed/noticias.xml
br|CNN Brasil|https://www.cnnbrasil.com.br/feed/
br|Poder360|https://www.poder360.com.br/feed/
mx|El Universal|https://www.eluniversal.com.mx/arc/outboundfeeds/rss/?outputType=xml
mx|Proceso|https://www.proceso.com.mx/rss/
mx|Animal Político|https://animalpolitico.com/feed
mx|Aristegui|https://aristeguinoticias.com/feed/
mx|Excélsior|https://www.excelsior.com.mx/rss.xml
il|Times of Israel|https://www.timesofisrael.com/feed/
il|i24NEWS|https://www.i24news.tv/en/rss
il|Israel Hayom|https://www.israelhayom.com/feed/
il|Globes|https://en.globes.co.il/WebService/Rss/RssFeeds.asmx/FeederNode?iID=942
il|Arutz Sheva|https://www.israelnationalnews.com/Rss.aspx
tr|Hürriyet Daily News|https://www.hurriyetdailynews.com/rss
tr|TRT World|https://www.trtworld.com/rss
tr|Duvar English|https://www.duvarenglish.com/rss
br|Agência Brasil EN|https://agenciabrasil.ebc.com.br/en/rss/ultimasnoticias/feed.xml`.split("\n").map((l) => l.split("|"));
const get = async (u) => { const c = new AbortController(), tm = setTimeout(() => c.abort(), 25000); try { const r = await fetch(u, { signal: c.signal, redirect: "follow", headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" } }); return [r.status, await r.text(), r.url]; } catch (e) { return [String(e.cause?.code || e.name), "", u]; } finally { clearTimeout(tm); } };
await Promise.all(C.map(async ([cc, name, u]) => {
  const [st, x, fin] = await get(u);
  const items = (x.match(/<item[\s>]|<entry[\s>]/g) || []).length;
  const dates = [...x.matchAll(/<(?:pubDate|updated|dc:date|published)>([^<]+)</g)].map((m) => Date.parse(m[1])).filter(Number.isFinite);
  const newest = dates.length ? new Date(Math.max(...dates)).toISOString().slice(0, 16) : "-";
  const t = ((x.match(/<item[\s\S]*?<title>(?:<!\[CDATA\[)?\s*([^<\]]{0,90})/) || x.match(/<entry[\s\S]*?<title[^>]*>(?:<!\[CDATA\[)?\s*([^<\]]{0,90})/) || [])[1] || "").trim();
  console.log("P", cc, "|", name, "|", st, "|", items, "|", newest, "|", fin !== u ? "->" + fin.slice(0, 80) : "", "|", t);
}));
