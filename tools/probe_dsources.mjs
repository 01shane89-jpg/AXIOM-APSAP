// One-off probe (workflow step only=probe-dsources): which Deep South IED-watch sources answer from GitHub's runners.
// Prints one line per URL: HTTP result, feed items or page size, newest item date, Deep South security items. Writes probe-out/dsources.json.
import fs from "node:fs";
import { parseFeed } from "./feedparse.mjs";
import { relevant } from "./deepsouth_lib.mjs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (AXIOM-OSAP Deep South refresh)";
const C = [
  ["1 ISOC Region 4 FC", "https://www.southpeace.go.th/?feed=rss2"],
  ["1 ISOC Region 4 FC", "https://www.southpeace.go.th/feed/"],
  ["1 ISOC Region 4 FC", "https://www.southpeace.go.th/?cat=21&feed=rss2"],
  ["1 ISOC Region 4 FC", "https://www.southpeace.go.th/wp-json/wp/v2/posts?per_page=20&_fields=date,link,title"],
  ["1 ISOC Region 4 FC", "https://www.southpeace.go.th/"],
  ["1 ISOC (HQ)", "https://www.isoc.go.th/?feed=rss2"],
  ["2 Fourth Army", "https://army4.rta.mi.th/"],
  ["2 Fourth Army", "https://army4.rta.mi.th/feed/"],
  ["3 Police Region 9", "https://www.police9.go.th/"],
  ["3 Police Region 9", "https://www.police9.go.th/feed/"],
  ["3 Police Region 9 CIB", "https://inv.p9.police.go.th/"],
  ["3 Royal Thai Police", "https://www.royalthaipolice.go.th/"],
  ["4 Pattani PR office", "https://pattani.prd.go.th/th/rss"],
  ["4 Pattani PR office", "https://pattani.prd.go.th/"],
  ["4 Yala PR office", "https://yala.prd.go.th/"],
  ["4 Narathiwat PR office", "https://narathiwat.prd.go.th/"],
  ["4 Songkhla PR office", "https://songkhla.prd.go.th/"],
  ["4 Narathiwat province", "https://www.narathiwat.go.th/"],
  ["4 Pattani province", "https://www.pattani.go.th/"],
  ["4 Yala province", "https://www.yala.go.th/"],
  ["4 SBPAC", "https://www.sbpac.go.th/?feed=rss2"],
  ["4 SBPAC", "https://www.sbpac.go.th/"],
  ["5 Isranews south", "https://www.isranews.org/article/south-news.html?format=feed&type=rss"],
  ["5 Isranews south", "https://www.isranews.org/south-news.feed?type=rss"],
  ["5 Isranews south", "https://www.isranews.org/article/south-news.html"],
  ["5 Isranews", "https://www.isranews.org/rss.xml"],
  ["6 Thai PBS World", "https://www.thaipbsworld.com/feed/"],
  ["6 Thai PBS World", "https://www.thaipbsworld.com/south-watch/"],
  ["6 Thai PBS World", "https://www.thaipbsworld.com/sitemap.xml"],
  ["6 Thai PBS", "https://www.thaipbs.or.th/rss/news/rss.xml"],
  ["6 Thai PBS", "https://www.thaipbs.or.th/news"],
  ["7 The Nation", "https://www.nationthailand.com/rss"],
  ["7 The Nation", "https://www.nationthailand.com/rss/news.xml"],
  ["7 The Nation", "https://www.nationthailand.com/news/general"],
  ["7 The Nation", "https://www.nationthailand.com/sitemap.xml"],
  ["8 Bangkok Post", "https://www.bangkokpost.com/rss/data/thailand.xml"],
  ["8 Bangkok Post", "https://www.bangkokpost.com/rss/data/most-recent.xml"],
  ["9 Reuters (search)", "https://www.bing.com/news/search?q=site%3Areuters.com+Thailand+south&format=rss"],
  ["9 AP (search)", "https://www.bing.com/news/search?q=site%3Aapnews.com+Thailand+south&format=rss"],
  ["10 Bernama", "https://www.bernama.com/en/rssfeed.php"],
  ["10 Bernama", "https://www.bernama.com/en/rss/world.xml"],
  ["10 Bernama", "https://www.bernama.com/en/world/"],
  ["10 Bernama (search)", "https://www.bing.com/news/search?q=Bernama+Narathiwat&format=rss"],
  ["11 PDRM", "https://www.rmp.gov.my/"],
  ["11 PDRM (search)", "https://www.bing.com/news/search?q=PDRM+sempadan+Kelantan&format=rss"],
  ["12 Malaysia MFA", "https://www.kln.gov.my/"],
  ["12 Malaysia MFA (search)", "https://www.bing.com/news/search?q=Wisma+Putra+Selatan+Thailand&format=rss"],
  ["13 Deep South Watch", "https://deepsouthwatch.org/th/node"],
  ["14 State Railway", "https://www.railway.co.th/"],
  ["14 State Railway (search)", "https://www.bing.com/news/search?q=%E0%B8%A3%E0%B8%9F%E0%B8%97.+%E0%B8%99%E0%B8%A3%E0%B8%B2%E0%B8%98%E0%B8%B4%E0%B8%A7%E0%B8%B2%E0%B8%AA&format=rss"],
  ["15 Thairath", "https://www.thairath.co.th/rss/news"],
  ["15 Daily News", "https://www.dailynews.co.th/feed/"],
  ["15 MGR Online south", "https://mgronline.com/rss/south"],
  ["15 Matichon (current)", "https://www.matichon.co.th/feed"],
  ["15 77 Kaoded", "https://77kaoded.news/feed"],
  ["15 77 Kaoded", "https://77kaoded.news/feed/"],
  ["15 77 Kaoded border", "https://77kaoded.news/border"],
  ["15 The Reporters", "https://www.thereporters.co/feed/"],
  ["15 The Reporters Deep South", "https://www.thereporters.co/deepsouth/"],
  ["15 The Reporters Deep South", "https://www.thereporters.co/category/deepsouth/feed/"],
];
// PROBE_SET=coverage: candidate searches and feeds for wider Deep South and Thai–Cambodian coverage (2026-09-28)
const COV = [
  ["DS search: ระเบิด ชายแดนใต้", "https://www.bing.com/news/search?q=%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%9A%E0%B8%B4%E0%B8%94%20%E0%B8%8A%E0%B8%B2%E0%B8%A2%E0%B9%81%E0%B8%94%E0%B8%99%E0%B9%83%E0%B8%95%E0%B9%89&format=rss"],
  ["DS search: ระเบิด นราธิวาส", "https://www.bing.com/news/search?q=%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%9A%E0%B8%B4%E0%B8%94%20%E0%B8%99%E0%B8%A3%E0%B8%B2%E0%B8%98%E0%B8%B4%E0%B8%A7%E0%B8%B2%E0%B8%AA&format=rss"],
  ["DS search: ระเบิด ปัตตานี", "https://www.bing.com/news/search?q=%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%9A%E0%B8%B4%E0%B8%94%20%E0%B8%9B%E0%B8%B1%E0%B8%95%E0%B8%95%E0%B8%B2%E0%B8%99%E0%B8%B5&format=rss"],
  ["DS search: ระเบิด ยะลา", "https://www.bing.com/news/search?q=%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%9A%E0%B8%B4%E0%B8%94%20%E0%B8%A2%E0%B8%B0%E0%B8%A5%E0%B8%B2&format=rss"],
  ["DS search: คนร้ายยิง นราธิวาส", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%E0%B8%A2%E0%B8%B4%E0%B8%87%20%E0%B8%99%E0%B8%A3%E0%B8%B2%E0%B8%98%E0%B8%B4%E0%B8%A7%E0%B8%B2%E0%B8%AA&format=rss"],
  ["DS search: คนร้ายยิง ปัตตานี", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%E0%B8%A2%E0%B8%B4%E0%B8%87%20%E0%B8%9B%E0%B8%B1%E0%B8%95%E0%B8%95%E0%B8%B2%E0%B8%99%E0%B8%B5&format=rss"],
  ["DS search: ทหารพราน ถูกยิง", "https://www.bing.com/news/search?q=%E0%B8%97%E0%B8%AB%E0%B8%B2%E0%B8%A3%E0%B8%9E%E0%B8%A3%E0%B8%B2%E0%B8%99%20%E0%B8%96%E0%B8%B9%E0%B8%81%E0%B8%A2%E0%B8%B4%E0%B8%87&format=rss"],
  ["DS search: อส. ถูกยิง", "https://www.bing.com/news/search?q=%E0%B8%AD%E0%B8%AA.%20%E0%B8%96%E0%B8%B9%E0%B8%81%E0%B8%A2%E0%B8%B4%E0%B8%87&format=rss"],
  ["DS search: วางเพลิง ชายแดนใต้", "https://www.bing.com/news/search?q=%E0%B8%A7%E0%B8%B2%E0%B8%87%E0%B9%80%E0%B8%9E%E0%B8%A5%E0%B8%B4%E0%B8%87%20%E0%B8%8A%E0%B8%B2%E0%B8%A2%E0%B9%81%E0%B8%94%E0%B8%99%E0%B9%83%E0%B8%95%E0%B9%89&format=rss"],
  ["DS search: ปิดล้อมตรวจค้น ชายแดนใต้", "https://www.bing.com/news/search?q=%E0%B8%9B%E0%B8%B4%E0%B8%94%E0%B8%A5%E0%B9%89%E0%B8%AD%E0%B8%A1%E0%B8%95%E0%B8%A3%E0%B8%A7%E0%B8%88%E0%B8%84%E0%B9%89%E0%B8%99%20%E0%B8%8A%E0%B8%B2%E0%B8%A2%E0%B9%81%E0%B8%94%E0%B8%99%E0%B9%83%E0%B8%95%E0%B9%89&format=rss"],
  ["DS search: ไฟใต้", "https://www.bing.com/news/search?q=%E0%B9%84%E0%B8%9F%E0%B9%83%E0%B8%95%E0%B9%89&format=rss"],
  ["DS search: คนร้าย จะนะ OR เทพา OR นาทวี OR สะบ้าย้อย", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%88%E0%B8%B0%E0%B8%99%E0%B8%B0%20OR%20%E0%B9%80%E0%B8%97%E0%B8%9E%E0%B8%B2%20OR%20%E0%B8%99%E0%B8%B2%E0%B8%97%E0%B8%A7%E0%B8%B5%20OR%20%E0%B8%AA%E0%B8%B0%E0%B8%9A%E0%B9%89%E0%B8%B2%E0%B8%A2%E0%B9%89%E0%B8%AD%E0%B8%A2&format=rss"],
  ["DS search: southern Thailand insurgents", "https://www.bing.com/news/search?q=southern%20Thailand%20insurgents&format=rss"],
  ["DS search: Deep South Thailand bomb", "https://www.bing.com/news/search?q=Deep%20South%20Thailand%20bomb&format=rss"],
  ["DS search: Narathiwat ranger", "https://www.bing.com/news/search?q=Narathiwat%20ranger&format=rss"],
  ["DS search: site:thairath.co.th ชายแดนใต้", "https://www.bing.com/news/search?q=site%3Athairath.co.th%20%E0%B8%8A%E0%B8%B2%E0%B8%A2%E0%B9%81%E0%B8%94%E0%B8%99%E0%B9%83%E0%B8%95%E0%B9%89&format=rss"],
  ["DS search: site:dailynews.co.th ชายแดนใต้", "https://www.bing.com/news/search?q=site%3Adailynews.co.th%20%E0%B8%8A%E0%B8%B2%E0%B8%A2%E0%B9%81%E0%B8%94%E0%B8%99%E0%B9%83%E0%B8%95%E0%B9%89&format=rss"],
  ["DS search: site:mgronline.com ชายแดนใต้", "https://www.bing.com/news/search?q=site%3Amgronline.com%20%E0%B8%8A%E0%B8%B2%E0%B8%A2%E0%B9%81%E0%B8%94%E0%B8%99%E0%B9%83%E0%B8%95%E0%B9%89&format=rss"],
  ["DS search: site:thaipbs.or.th ชายแดนใต้", "https://www.bing.com/news/search?q=site%3Athaipbs.or.th%20%E0%B8%8A%E0%B8%B2%E0%B8%A2%E0%B9%81%E0%B8%94%E0%B8%99%E0%B9%83%E0%B8%95%E0%B9%89&format=rss"],
  ["DS search: site:bangkokpost.com (Narathiwat OR Pattani OR Yala)", "https://www.bing.com/news/search?q=site%3Abangkokpost.com%20%28Narathiwat%20OR%20Pattani%20OR%20Yala%29&format=rss"],
  ["DS search: นราธิวาส &qft=sortbydate%3d%221%22", "https://www.bing.com/news/search?q=%E0%B8%99%E0%B8%A3%E0%B8%B2%E0%B8%98%E0%B8%B4%E0%B8%A7%E0%B8%B2%E0%B8%AA&format=rss&qft=sortbydate%3d%221%22"],
  ["DS search: ไฟใต้ &count=50", "https://www.bing.com/news/search?q=%E0%B9%84%E0%B8%9F%E0%B9%83%E0%B8%95%E0%B9%89&format=rss&count=50"],
  ["TK search: Thai Cambodian border", "https://www.bing.com/news/search?q=Thai%20Cambodian%20border&format=rss"],
  ["TK search: Cambodia Thailand ceasefire", "https://www.bing.com/news/search?q=Cambodia%20Thailand%20ceasefire&format=rss"],
  ["TK search: Thai army Cambodian troops", "https://www.bing.com/news/search?q=Thai%20army%20Cambodian%20troops&format=rss"],
  ["TK search: ชายแดนไทย-กัมพูชา", "https://www.bing.com/news/search?q=%E0%B8%8A%E0%B8%B2%E0%B8%A2%E0%B9%81%E0%B8%94%E0%B8%99%E0%B9%84%E0%B8%97%E0%B8%A2-%E0%B8%81%E0%B8%B1%E0%B8%A1%E0%B8%9E%E0%B8%B9%E0%B8%8A%E0%B8%B2&format=rss"],
  ["TK search: ทหารกัมพูชา", "https://www.bing.com/news/search?q=%E0%B8%97%E0%B8%AB%E0%B8%B2%E0%B8%A3%E0%B8%81%E0%B8%B1%E0%B8%A1%E0%B8%9E%E0%B8%B9%E0%B8%8A%E0%B8%B2&format=rss"],
  ["TK search: กองกำลังบูรพา", "https://www.bing.com/news/search?q=%E0%B8%81%E0%B8%AD%E0%B8%87%E0%B8%81%E0%B8%B3%E0%B8%A5%E0%B8%B1%E0%B8%87%E0%B8%9A%E0%B8%B9%E0%B8%A3%E0%B8%9E%E0%B8%B2&format=rss"],
  ["TK search: กองกำลังสุรนารี", "https://www.bing.com/news/search?q=%E0%B8%81%E0%B8%AD%E0%B8%87%E0%B8%81%E0%B8%B3%E0%B8%A5%E0%B8%B1%E0%B8%87%E0%B8%AA%E0%B8%B8%E0%B8%A3%E0%B8%99%E0%B8%B2%E0%B8%A3%E0%B8%B5&format=rss"],
  ["TK search: ทุ่นระเบิด ชายแดน", "https://www.bing.com/news/search?q=%E0%B8%97%E0%B8%B8%E0%B9%88%E0%B8%99%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%9A%E0%B8%B4%E0%B8%94%20%E0%B8%8A%E0%B8%B2%E0%B8%A2%E0%B9%81%E0%B8%94%E0%B8%99&format=rss"],
  ["TK search: ព្រំដែនកម្ពុជា ថៃ", "https://www.bing.com/news/search?q=%E1%9E%96%E1%9F%92%E1%9E%9A%E1%9F%86%E1%9E%8A%E1%9F%82%E1%9E%93%E1%9E%80%E1%9E%98%E1%9F%92%E1%9E%96%E1%9E%BB%E1%9E%87%E1%9E%B6%20%E1%9E%90%E1%9F%83&format=rss"],
  ["TK search: landmine Cambodia Thailand", "https://www.bing.com/news/search?q=landmine%20Cambodia%20Thailand&format=rss"],
  ["TK search: site:khmertimeskh.com Thai border", "https://www.bing.com/news/search?q=site%3Akhmertimeskh.com%20Thai%20border&format=rss"],
  ["TK search: site:phnompenhpost.com Thai", "https://www.bing.com/news/search?q=site%3Aphnompenhpost.com%20Thai&format=rss"],
  ["TK search: JBC Cambodia Thailand", "https://www.bing.com/news/search?q=JBC%20Cambodia%20Thailand&format=rss"],
  ["TK search: ASEAN observer team border", "https://www.bing.com/news/search?q=ASEAN%20observer%20team%20border&format=rss"],
  ["TK Khmer Times", "https://www.khmertimeskh.com/feed/"],
  ["TK Phnom Penh Post", "https://phnompenhpost.com/rss"],
  ["TK Phnom Penh Post", "https://www.phnompenhpost.com/rss.xml"],
  ["TK CamboJA", "https://cambojanews.com/feed/"],
  ["TK Kiripost", "https://kiripost.com/feed"],
  ["TK Cambodianess", "https://cambodianess.com/rss"],
  ["TK AKP", "https://www.akp.gov.kh/rss"],
  ["TK Fresh News EN", "https://en.freshnewsasia.com/index.php/en/?format=feed&type=rss"],
  ["TK VOD", "https://vodenglish.news/feed/"],
  ["TK Khmer Times TH border tag", "https://www.khmertimeskh.com/tag/thai-border/feed/"],
  ["DS Wartani", "https://www.wartani.com/feed"],
  ["DS DSJ", "https://dsj.co.th/feed"],
  ["DS Bangkok Post thailand", "https://www.bangkokpost.com/rss/data/thailand.xml"],
  ["DS Nation south", "https://www.nationthailand.com/rss/thailand"],
  ["DS Thai PBS south", "https://www.thaipbs.or.th/rss/news/south.xml"],
];
// default probe also tries these candidates for recent Deep South incidents (2026-09-29): date-sorted searches, one search per district, Malay-language and outlet searches, section feeds
const RECENT = [
  ["R sorted: ชายแดนใต้", "https://www.bing.com/news/search?q=%E0%B8%8A%E0%B8%B2%E0%B8%A2%E0%B9%81%E0%B8%94%E0%B8%99%E0%B9%83%E0%B8%95%E0%B9%89&format=rss&qft=sortbydate%3d%221%22"],
  ["R sorted: นราธิวาส", "https://www.bing.com/news/search?q=%E0%B8%99%E0%B8%A3%E0%B8%B2%E0%B8%98%E0%B8%B4%E0%B8%A7%E0%B8%B2%E0%B8%AA&format=rss&qft=sortbydate%3d%221%22"],
  ["R sorted: ปัตตานี", "https://www.bing.com/news/search?q=%E0%B8%9B%E0%B8%B1%E0%B8%95%E0%B8%95%E0%B8%B2%E0%B8%99%E0%B8%B5&format=rss&qft=sortbydate%3d%221%22"],
  ["R sorted: ยะลา", "https://www.bing.com/news/search?q=%E0%B8%A2%E0%B8%B0%E0%B8%A5%E0%B8%B2&format=rss&qft=sortbydate%3d%221%22"],
  ["R sorted: คนร้ายยิง", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%E0%B8%A2%E0%B8%B4%E0%B8%87&format=rss&qft=sortbydate%3d%221%22"],
  ["R sorted: ลอบวางระเบิด", "https://www.bing.com/news/search?q=%E0%B8%A5%E0%B8%AD%E0%B8%9A%E0%B8%A7%E0%B8%B2%E0%B8%87%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%9A%E0%B8%B4%E0%B8%94&format=rss&qft=sortbydate%3d%221%22"],
  ["R sorted: ทหารพราน", "https://www.bing.com/news/search?q=%E0%B8%97%E0%B8%AB%E0%B8%B2%E0%B8%A3%E0%B8%9E%E0%B8%A3%E0%B8%B2%E0%B8%99&format=rss&qft=sortbydate%3d%221%22"],
  ["R sorted: ไฟใต้", "https://www.bing.com/news/search?q=%E0%B9%84%E0%B8%9F%E0%B9%83%E0%B8%95%E0%B9%89&format=rss&qft=sortbydate%3d%221%22"],
  ["R district: คนร้าย รือเสาะ", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%A3%E0%B8%B7%E0%B8%AD%E0%B9%80%E0%B8%AA%E0%B8%B2%E0%B8%B0&format=rss"],
  ["R district: คนร้าย ระแงะ", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%A3%E0%B8%B0%E0%B9%81%E0%B8%87%E0%B8%B0&format=rss"],
  ["R district: คนร้าย บาเจาะ", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%9A%E0%B8%B2%E0%B9%80%E0%B8%88%E0%B8%B2%E0%B8%B0&format=rss"],
  ["R district: คนร้าย ตากใบ", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%95%E0%B8%B2%E0%B8%81%E0%B9%83%E0%B8%9A&format=rss"],
  ["R district: คนร้าย สุไหงโก-ลก", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%AA%E0%B8%B8%E0%B9%84%E0%B8%AB%E0%B8%87%E0%B9%82%E0%B8%81-%E0%B8%A5%E0%B8%81&format=rss"],
  ["R district: คนร้าย เจาะไอร้อง", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B9%80%E0%B8%88%E0%B8%B2%E0%B8%B0%E0%B9%84%E0%B8%AD%E0%B8%A3%E0%B9%89%E0%B8%AD%E0%B8%87&format=rss"],
  ["R district: คนร้าย ศรีสาคร", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%A8%E0%B8%A3%E0%B8%B5%E0%B8%AA%E0%B8%B2%E0%B8%84%E0%B8%A3&format=rss"],
  ["R district: คนร้าย สุคิริน", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%AA%E0%B8%B8%E0%B8%84%E0%B8%B4%E0%B8%A3%E0%B8%B4%E0%B8%99&format=rss"],
  ["R district: คนร้าย จะแนะ", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%88%E0%B8%B0%E0%B9%81%E0%B8%99%E0%B8%B0&format=rss"],
  ["R district: คนร้าย ยี่งอ", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%A2%E0%B8%B5%E0%B9%88%E0%B8%87%E0%B8%AD&format=rss"],
  ["R district: คนร้าย รามัน", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%A3%E0%B8%B2%E0%B8%A1%E0%B8%B1%E0%B8%99&format=rss"],
  ["R district: คนร้าย บันนังสตา", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%9A%E0%B8%B1%E0%B8%99%E0%B8%99%E0%B8%B1%E0%B8%87%E0%B8%AA%E0%B8%95%E0%B8%B2&format=rss"],
  ["R district: คนร้าย ธารโต", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%98%E0%B8%B2%E0%B8%A3%E0%B9%82%E0%B8%95&format=rss"],
  ["R district: คนร้าย กรงปินัง", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%81%E0%B8%A3%E0%B8%87%E0%B8%9B%E0%B8%B4%E0%B8%99%E0%B8%B1%E0%B8%87&format=rss"],
  ["R district: คนร้าย หนองจิก", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%AB%E0%B8%99%E0%B8%AD%E0%B8%87%E0%B8%88%E0%B8%B4%E0%B8%81&format=rss"],
  ["R district: คนร้าย ยะหริ่ง", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%A2%E0%B8%B0%E0%B8%AB%E0%B8%A3%E0%B8%B4%E0%B9%88%E0%B8%87&format=rss"],
  ["R district: คนร้าย สายบุรี", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%AA%E0%B8%B2%E0%B8%A2%E0%B8%9A%E0%B8%B8%E0%B8%A3%E0%B8%B5&format=rss"],
  ["R district: คนร้าย โคกโพธิ์", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B9%82%E0%B8%84%E0%B8%81%E0%B9%82%E0%B8%9E%E0%B8%98%E0%B8%B4%E0%B9%8C&format=rss"],
  ["R district: คนร้าย มายอ", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%A1%E0%B8%B2%E0%B8%A2%E0%B8%AD&format=rss"],
  ["R district: คนร้าย ยะรัง", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%A2%E0%B8%B0%E0%B8%A3%E0%B8%B1%E0%B8%87&format=rss"],
  ["R district: คนร้าย ปะนาเระ", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%9B%E0%B8%B0%E0%B8%99%E0%B8%B2%E0%B9%80%E0%B8%A3%E0%B8%B0&format=rss"],
  ["R district: คนร้าย ทุ่งยางแดง", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%97%E0%B8%B8%E0%B9%88%E0%B8%87%E0%B8%A2%E0%B8%B2%E0%B8%87%E0%B9%81%E0%B8%94%E0%B8%87&format=rss"],
  ["R district: คนร้าย กะพ้อ", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%81%E0%B8%B0%E0%B8%9E%E0%B9%89%E0%B8%AD&format=rss"],
  ["R district: คนร้าย ไม้แก่น", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B9%84%E0%B8%A1%E0%B9%89%E0%B9%81%E0%B8%81%E0%B9%88%E0%B8%99&format=rss"],
  ["R district: คนร้าย แม่ลาน", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B9%81%E0%B8%A1%E0%B9%88%E0%B8%A5%E0%B8%B2%E0%B8%99&format=rss"],
  ["R district: คนร้าย จะนะ", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%88%E0%B8%B0%E0%B8%99%E0%B8%B0&format=rss"],
  ["R district: คนร้าย เทพา", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B9%80%E0%B8%97%E0%B8%9E%E0%B8%B2&format=rss"],
  ["R district: คนร้าย สะบ้าย้อย", "https://www.bing.com/news/search?q=%E0%B8%84%E0%B8%99%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%A2%20%E0%B8%AA%E0%B8%B0%E0%B8%9A%E0%B9%89%E0%B8%B2%E0%B8%A2%E0%B9%89%E0%B8%AD%E0%B8%A2&format=rss"],
  ["R malay: selatan Thailand tembak", "https://www.bing.com/news/search?q=selatan%20Thailand%20tembak&format=rss"],
  ["R malay: wilayah selatan Thailand letupan", "https://www.bing.com/news/search?q=wilayah%20selatan%20Thailand%20letupan&format=rss"],
  ["R malay: Narathiwat serangan", "https://www.bing.com/news/search?q=Narathiwat%20serangan&format=rss"],
  ["R malay: site:bernama.com selatan Thailand", "https://www.bing.com/news/search?q=site%3Abernama.com%20selatan%20Thailand&format=rss"],
  ["R malay: site:hmetro.com.my selatan Thailand", "https://www.bing.com/news/search?q=site%3Ahmetro.com.my%20selatan%20Thailand&format=rss"],
  ["R malay: site:utusan.com.my selatan Thailand", "https://www.bing.com/news/search?q=site%3Autusan.com.my%20selatan%20Thailand&format=rss"],
  ["R malay: site:bharian.com.my selatan Thailand", "https://www.bing.com/news/search?q=site%3Abharian.com.my%20selatan%20Thailand&format=rss"],
  ["R site: site:isranews.org ชายแดนใต้", "https://www.bing.com/news/search?q=site%3Aisranews.org%20%E0%B8%8A%E0%B8%B2%E0%B8%A2%E0%B9%81%E0%B8%94%E0%B8%99%E0%B9%83%E0%B8%95%E0%B9%89&format=rss"],
  ["R site: site:thaipbs.or.th นราธิวาส", "https://www.bing.com/news/search?q=site%3Athaipbs.or.th%20%E0%B8%99%E0%B8%A3%E0%B8%B2%E0%B8%98%E0%B8%B4%E0%B8%A7%E0%B8%B2%E0%B8%AA&format=rss"],
  ["R site: site:thereporters.co deepsouth", "https://www.bing.com/news/search?q=site%3Athereporters.co%20deepsouth&format=rss"],
  ["R site: site:77kaoded.news border", "https://www.bing.com/news/search?q=site%3A77kaoded.news%20border&format=rss"],
  ["R site: site:hatyaifocus.com ชายแดนใต้", "https://www.bing.com/news/search?q=site%3Ahatyaifocus.com%20%E0%B8%8A%E0%B8%B2%E0%B8%A2%E0%B9%81%E0%B8%94%E0%B8%99%E0%B9%83%E0%B8%95%E0%B9%89&format=rss"],
  ["R site: site:nationthailand.com Narathiwat", "https://www.bing.com/news/search?q=site%3Anationthailand.com%20Narathiwat&format=rss"],
  ["R site: site:benarnews.org Thailand south", "https://www.bing.com/news/search?q=site%3Abenarnews.org%20Thailand%20south&format=rss"],
  ["R 77 Kaoded border feed", "https://77kaoded.news/border/feed/"],
  ["R 77 Kaoded category border feed", "https://77kaoded.news/category/border/feed/"],
  ["R 77 Kaoded crime feed", "https://77kaoded.news/crime/feed/"],
  ["R The Reporters deepsouth feed", "https://www.thereporters.co/category/deepsouth/feed/"],
  ["R Hatyai Focus feed", "https://www.hatyaifocus.com/feed/"],
  ["R Thai PBS south page", "https://www.thaipbs.or.th/news/categories/south"],
  ["R Isranews south page", "https://www.isranews.org/article/south-news.html"],
];
const LIST = process.env.PROBE_SET === "coverage" ? COV : C.concat(RECENT);
const out = [];
for (const [src, url] of LIST) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000), r0 = { src, url };
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml, text/html, application/json, */*" } });
    const body = await r.text();
    Object.assign(r0, { status: r.status, type: (r.headers.get("content-type") || "").split(";")[0], bytes: body.length, final: r.url !== url ? r.url : "" });
    const items = parseFeed(body);
    if (items.length) {
      const ds = items.filter((i) => /^TK/.test(src) ? /Cambodia|Thai|กัมพูชา|ชายแดน|កម្ពុជា|ថៃ/i.test(i.title + " " + i.summary) : relevant({}, i.title + " " + i.summary));
      Object.assign(r0, { d7: items.filter((i) => Date.now() - new Date(i.date) < 7 * 864e5).length, items: items.length, newest: items.map((i) => { const d = new Date(i.date); return isNaN(d) ? "" : d.toISOString().slice(0, 16); }).sort().pop(), ds: ds.length, sample: (ds.length ? ds : items).slice(0, 3).map((i) => i.title.slice(0, 100)) });
    } else if (/json/.test(r0.type)) {
      try { const j = JSON.parse(body); if (Array.isArray(j)) Object.assign(r0, { items: j.length, newest: (j[0] || {}).date || "", sample: j.slice(0, 3).map((x) => ((x.title || {}).rendered || "").slice(0, 100)) }); } catch (e) {}
    } else {
      const title = (body.match(/<title[^>]*>([^<]*)/i) || [])[1] || "";
      const links = [...body.matchAll(/<a\b[^>]*>([^<]{15,200})<\/a>/g)].map((m) => m[1].trim()).filter((x) => relevant({}, x));
      Object.assign(r0, { title: title.trim().slice(0, 80), ds_links: links.length, sample: links.slice(0, 3).map((x) => x.slice(0, 100)) });
    }
  } catch (e) { r0.error = e.name === "AbortError" ? "timed out" : (e.cause && e.cause.code) || e.message; }
  clearTimeout(t);
  out.push(r0);
  console.log((r0.error || r0.status >= 400 ? "FAIL " : "ok   ") + src.padEnd(26) + " " + (r0.error || r0.status + " " + r0.type + " " + r0.bytes + "b" + (r0.items ? " items " + r0.items + " (7d " + r0.d7 + ") newest " + r0.newest + " ds " + r0.ds : "") + (r0.ds_links != null ? " page ds-links " + r0.ds_links : "")) + "  " + url);
  (r0.sample || []).forEach((s) => console.log("        " + s));
  if (/bing\.com/.test(url)) await new Promise((r) => setTimeout(r, 1000));
}
fs.mkdirSync("probe-out", { recursive: true });
fs.writeFileSync("probe-out/dsources.json", JSON.stringify(out, null, 1));
