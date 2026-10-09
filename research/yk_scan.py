# scratch: find every hospital registered for 輸血管理料 in the 8 regional health bureaus' lists (never merged)
import io, json, re, sys, zipfile, hashlib, urllib.request, urllib.parse, csv
PAGES = {
 "hokkaido": "https://kouseikyoku.mhlw.go.jp/hokkaido/gyomu/gyomu/hoken_kikan/todokede_juri_ichiran.html",
 "tohoku": "https://kouseikyoku.mhlw.go.jp/tohoku/gyomu/gyomu/hoken_kikan/documents/201805koushin.html",
 "kantoshinetsu": "https://kouseikyoku.mhlw.go.jp/kantoshinetsu/chousa/kijyun.html",
 "tokaihokuriku": "https://kouseikyoku.mhlw.go.jp/tokaihokuriku/newpage_00349.html",
 "kinki": "https://kouseikyoku.mhlw.go.jp/kinki/gyomu/gyomu/hoken_kikan/shitei_jokyo_00004.html",
 "chugokushikoku": "https://kouseikyoku.mhlw.go.jp/chugokushikoku/chousaka/shisetsukijunjuri.html",
 "shikoku": "https://kouseikyoku.mhlw.go.jp/shikoku/gyomu/gyomu/hoken_kikan/shitei/index.html",
 "kyushu": "https://kouseikyoku.mhlw.go.jp/kyushu/gyomu/gyomu/hoken_kikan/index_00007.html"}
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/126"}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=180).read()
import openpyxl
out, log, files = [], [], []
for b, page in PAGES.items():
    html = get(page).decode("utf-8", "replace")
    for href, txt in re.findall(r'href="([^"]+\.(?:zip|xlsx))"[^>]*>([^<]{0,80})', html):
        if re.search(r"歯科|薬局|併用|訪問", txt) or re.search(r"shika|yakkyoku|heiyo|houmon", href): continue
        u = urllib.parse.urljoin(page, href)
        try: data = get(u)
        except Exception as e: log.append("%s FAIL %s %s" % (b, u, e)); continue
        files.append({"bureau": b, "url": u, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "label": txt.strip()})
        books = []
        if u.endswith(".zip"):
            z = zipfile.ZipFile(io.BytesIO(data))
            books = [(n, z.read(n)) for n in z.namelist() if n.lower().endswith(".xlsx")]
        else: books = [(u.rsplit("/", 1)[1], data)]
        for n, raw in books:
            try: wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
            except Exception as e: log.append("%s BADXLSX %s %s" % (b, n, e)); continue
            hits = 0
            for ws in wb.worksheets:
                hdr = None
                for row in ws.iter_rows(values_only=True):
                    cells = ["" if c is None else str(c).strip() for c in row]
                    if hdr is None and any("医療機関名" in c for c in cells): hdr = cells; continue
                    j = " ".join(cells)
                    if "輸血管理" in j or "輸血適正" in j:
                        hits += 1
                        out.append({"bureau": b, "file": u, "book": n, "sheet": ws.title, "hdr": hdr, "cells": cells})
            log.append("%s %s %s hits=%d" % (b, u, n, hits))
json.dump({"files": files, "rows": out}, open("research/out/yk_rows.json", "w"), ensure_ascii=False)
open("research/out/yk_log.txt", "w").write("\n".join(log))
print(len(out), "rows")
