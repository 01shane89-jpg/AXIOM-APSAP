#!/usr/bin/env python3
"""Extracts the air diving tables from the U.S. Navy Diving Manual, Revision 7 (NAVSEA SS521-AG-PRO-010), Chapter 9:
Table 9-6 (surface interval before ascent to altitude), 9-7 (no-decompression limits and repetitive groups), 9-8 (residual
nitrogen time) and 9-9 (air decompression table), from `pdftotext -layout` text of the manual, one file per PDF page.

Every table is read from the manual's own text and checked as it is read:
- 9-6: groups A..Z in order, times never fall going down a column or across a row;
- 9-7: groups in order with no gaps, times rise across each row, the last time equals the no-stop limit;
- 9-8: 16 residual nitrogen times per depth; surface interval rows hand-copied from the page (its diagonal layout does not
  read as columns), each printed time found on the page and every interval starting one minute after the one before;
- 9-9: every stop placed under its depth column, stops run without a gap down to 20 fsw, the time to the first stop equals the
  travel from the bottom at 30 fsw/min, and time to first stop + the stops + 0:40 to the surface equals the printed total
  ascent time on every AIR row.

Usage: divetables_extract.py PAGES_DIR OUT.json        (PAGES_DIR holds p0492.txt ... or pg492.txt ...)
       divetables_extract.py PAGES_DIR --check DATA.json  (exit 1 if DATA.json's tables differ from the manual)
"""
import json, os, re, sys

G = "ABCDEFGHIJKLMNOZ"


def ms(s):
    m, s2 = s.split(':'); return int(m) * 60 + int(s2)


def hm(s):
    s = s.strip('*')
    h, m = (s.split(':') if not s.startswith(':') else ('0', s[1:])); return int(h or 0) * 60 + int(m)


def extract(pages):
    def page(n):
        for f in ("p%04d.txt" % n, "pg%d.txt" % n):
            p = os.path.join(pages, f)
            if os.path.exists(p): return open(p, encoding="utf-8")
        raise SystemExit("missing page %d in %s" % (n, pages))
    errs = []
    G="ABCDEFGHIJKLMNOZ"
    def hm(s):
        s=s.strip('*')
        h,m=(s.split(':') if not s.startswith(':') else ('0',s[1:])); return int(h or 0)*60+int(m)
    # 9-6
    L=page(492).read().split('\n')
    t96={}
    for l in L:
        m=re.match(r'^\s+([A-OZ])\s+((?:\d+:\d\d\s*){10})$',l)
        if m: t96[m.group(1)]=[hm(x) for x in m.group(2).split()]
    assert list(t96)==list(G),list(t96)
    for g in G:
        r=t96[g]; assert r==sorted(r),g
    for i in range(10): assert [t96[g][i] for g in G]==sorted(t96[g][i] for g in G)
    # 9-7
    L=page(493).read().split('\n')
    hdr=[l for l in L if re.search(r'\bA\s+B\s+C',l)][0]
    gc={m.group(0):m.end() for m in re.finditer(r'\b[A-OZ]\b',hdr[hdr.index('Limit')+5:])}
    off=hdr.index('Limit')+5; gc={k:v+off for k,v in gc.items()}
    t97=[]
    for l in L:
        m=re.match(r'^\s*(\d+)\s+(Unlimited|\d+)\s(.*)$',l)
        if not m or int(m.group(1))>190: continue
        d=int(m.group(1)); lim=None if m.group(2)=="Unlimited" else int(m.group(2))
        row={"depth":d,"no_stop_limit":lim,"groups":{}}
        st=l.index(m.group(2))+len(m.group(2))
        for t in re.finditer(r'\S+',l[st:]):
            e=t.end()+st
            g=min(gc,key=lambda k:abs(gc[k]-e))
            if abs(gc[g]-e)>3 and t.group(0)!="*": errs.append(("97align",l,t.group(0)))
            if t.group(0)=="*": row["max_group"]=G[G.index(list(row["groups"])[-1])+1]; continue
            row["groups"][g]=int(t.group(0))
        t97.append(row)
    for r in t97:
        ks=list(r["groups"]); vs=list(r["groups"].values())
        if vs!=sorted(vs) or len(set(vs))!=len(vs): errs.append(("97mono",r))
        if ks!=[g for g in G if g in ks]: errs.append(("97order",r))
        # contiguous groups (some deep rows start at B or C)
        idx=[G.index(k) for k in ks]
        if idx!=list(range(idx[0],idx[-1]+1)): errs.append(("97gap",r))
        if r["no_stop_limit"] is not None and vs[-1]!=r["no_stop_limit"]: errs.append(("97lim",r))
    # 9-8 bottom half
    L=page(494).read().split('\n')
    hdr=[l for l in L if re.match(r'^\s+Z\s+O\s+N\s+M',l)][0]
    gc={m.group(0):m.end() for m in re.finditer(r'\b[A-OZ]\b',hdr)}
    rnt={}
    for l in L:
        m=re.match(r'^\s*(\d+)\s+((?:\S+\s+){15}\S+)\s*$',l)
        if not m: continue
        d=int(m.group(1)); 
        if d>190 or d<10: continue
        toks=m.group(2).split()
        if len(toks)!=16: errs.append(("98n",d,toks))
        row={}
        for g,v in zip("ZONMLKJIHGFEDCBA",toks): row[g]= None if v=="**" else ("dagger" if v=="\u2020" else int(v))
        rnt[str(d)]={g:row[g] for g in G}
    for d,row in rnt.items():
        nums=[row[g] for g in G if isinstance(row[g],int)]
        if nums!=sorted(nums): errs.append(("98mono",d))
    # 9-8 top half: surface interval rows, start group -> list of (min,max) for groups from start down to A
    txt=page(494).read()
    # hand-transcribed from the extracted text (diagonal layout does not parse by columns); checked below
    SI_MIN={
    "A":":10","B":":10 1:17","C":":10 :56 2:12","D":":10 :53 1:48 3:04","E":":10 :53 1:45 2:40 3:56","F":":10 :53 1:45 2:38 3:32 4:49",
    "G":":10 :53 1:45 2:38 3:30 4:24 5:41","H":":10 :53 1:45 2:38 3:30 4:22 5:17 6:33","I":":10 :53 1:45 2:38 3:30 4:22 5:14 6:09 7:25",
    "J":":10 :53 1:45 2:38 3:30 4:22 5:14 6:07 7:01 8:17","K":":10 :53 1:45 2:38 3:30 4:22 5:14 6:07 6:59 7:53 9:10",
    "L":":10 :53 1:45 2:38 3:30 4:22 5:14 6:07 6:59 7:51 8:45 10:02","M":":10 :53 1:45 2:38 3:30 4:22 5:14 6:07 6:59 7:51 8:43 9:38 10:54",
    "N":":10 :53 1:45 2:38 3:30 4:22 5:14 6:07 6:59 7:51 8:43 9:35 10:30 11:46","O":":10 :53 1:45 2:38 3:30 4:22 5:14 6:07 6:59 7:51 8:43 9:35 10:28 11:22 12:38",
    "Z":":10 :53 1:45 2:38 3:30 4:22 5:14 6:07 6:59 7:51 8:43 9:35 10:28 11:20 12:14 13:31"}
    SI_MAX={
    "A":"2:20","B":"1:16 3:36","C":":55 2:11 4:31","D":":52 1:47 3:03 5:23","E":":52 1:44 2:39 3:55 6:15","F":":52 1:44 2:37 3:31 4:48 7:08",
    "G":":52 1:44 2:37 3:29 4:23 5:40 8:00","H":":52 1:44 2:37 3:29 4:21 5:16 6:32 8:52","I":":52 1:44 2:37 3:29 4:21 5:13 6:08 7:24 9:44",
    "J":":52 1:44 2:37 3:29 4:21 5:13 6:06 7:00 8:16 10:36","K":":52 1:44 2:37 3:29 4:21 5:13 6:06 6:58 7:52 9:09 11:29",
    "L":":52 1:44 2:37 3:29 4:21 5:13 6:06 6:58 7:50 8:44 10:01 12:21","M":":52 1:44 2:37 3:29 4:21 5:13 6:06 6:58 7:50 8:42 9:37 10:53 13:13",
    "N":":52 1:44 2:37 3:29 4:21 5:13 6:06 6:58 7:50 8:42 9:34 10:29 11:45 14:05","O":":52 1:44 2:37 3:29 4:21 5:13 6:06 6:58 7:50 8:42 9:34 10:27 11:21 12:37 14:58",
    "Z":":52 1:44 2:37 3:29 4:21 5:13 6:06 6:58 7:50 8:42 9:34 10:27 11:19 12:13 13:30 15:50"}
    si={}
    for g in G:
        mn=SI_MIN[g].split(); mx=SI_MAX[g].split(); n=G.index(g)+1
        if len(mn)!=n or len(mx)!=n: errs.append(("sin",g))
        # every token appears in the extracted page text as printed
        for t in mn+mx:
            if not re.search(r'(?<![\d:])'+re.escape(t)+r'(?![\d])',txt): errs.append(("sitxt",g,t))
        # interval i (left to right) ends in group G[n-1-i]: the row's own group first, A last
        rows=[]
        for i in range(n):
            a,b=hm(mn[i]),hm(mx[i])
            if a>b: errs.append(("siab",g,i))
            if i and a!=hm(mx[i-1])+1: errs.append(("sicont",g,i))
            rows.append({"min":a,"max":b,"group":G[n-1-i]})
        if rows[0]["min"]!=10: errs.append(("si10",g))
        si[g]=rows
    # the diagonal text rows: each printed max line (with *) appears in the text with the star
    for g in G:
        last=SI_MAX[g].split()[-1]
        if not re.search(re.escape(last)+r'\s*\*',txt): errs.append(("sistar",g,last))

    out = []
    zone_map=[("SurDO2 Recommended","o2_recommended"),("In-Water Air Decompression ------------- In-Water Air/O2 Decompression or SurDO2 Required","exceptional_air_o2_required"),
     ("Air/02 Decompression ------------- SurDO2 Required","exceptional_surdo2_required"),("Air/O2 Decompression ------------- SurDO2 Required","exceptional_surdo2_required"),
     ("Exceptional Exposure: SurDO2 ---","exceptional_surdo2_only"),("Exceptional Exposure ---","exceptional")]
    for pg in range(495,517):
        L=page(pg).read().split('\n')
        hdr=[l for l in L if re.search(r'\(M:S\).*\b20\b',l)][0]
        cols={}
        for m in re.finditer(r'\b(130|120|110|100|90|80|70|60|50|40|30|20)\b',hdr): cols[int(m.group(1))]=m.end()
        depth=None; zone="normal"; cur=None
        for l in L:
            m=re.match(r'^\s*(\d+) FSW\s*$',l)
            if m: depth=int(m.group(1)); zone="normal"; continue
            if '-----' in l:
                z=[v for k,v in zone_map if k in l]
                if not z: errs.append(("zone?",pg,l)); 
                else: zone=z[0]
                continue
            m=re.match(r'^(\s*)(\d+)\s+(\d+:\d\d)\s+AIR\s(.*)$',l)
            g=None
            if m:
                rest=l[m.end(3):]
                cur={"depth":depth,"bt":int(m.group(2)),"first_stop_s":ms(m.group(3)),"zone":zone,"page":pg}
                out.append(cur); kind="air"
            else:
                m=re.match(r'^\s*AIR/O2\s(.*)$',l)
                if not m: continue
                kind="o2"
            toks=[(t.group(0),t.end()) for t in re.finditer(r'\S+',l)]
            # strip leading tokens up to gas mix
            i=[k for k,(t,e) in enumerate(toks) if t in("AIR","AIR/O2")][0]
            toks=toks[i+1:]
            # trailing: total ascent (has colon), then for air: periods, group(optional)
            ti=[k for k,(t,e) in enumerate(toks) if ':' in t]
            if len(ti)!=1: errs.append(("asc?",pg,l)); continue
            ti=ti[0]; stops_t=toks[:ti]; tail=toks[ti+1:]
            stops={}
            for t,e in stops_t:
                if not re.fullmatch(r'\d+',t): errs.append(("tok",pg,l)); continue
                best=min(cols,key=lambda c:abs(cols[c]-e))
                if abs(cols[best]-e)>4: errs.append(("align",pg,t,e,cols,l))
                if best in stops: errs.append(("dup",pg,l))
                stops[best]=int(t)
            rec={"stops":{str(k):v for k,v in sorted(stops.items(),reverse=True)},"total_ascent_s":ms(toks[ti][0])}
            if kind=="air":
                if tail:
                    cur["chamber_o2_periods"]=float(tail[0][0]) if re.fullmatch(r'[\d.]+',tail[0][0]) else errs.append(("per",pg,l))
                    if len(tail)>1: cur["group"]=tail[1][0]
                    if len(tail)>2: errs.append(("tail",pg,l))
                cur["air"]=rec
            else:
                if tail: errs.append(("o2tail",pg,l))
                if cur is None or "air/o2" in cur: errs.append(("o2orphan",pg,l))
                cur["air_o2"]=rec
    # checks
    for r in out:
        a=r["air"]; s=a["stops"]; ds=sorted(map(int,s),reverse=True)
        if ds and ds!=list(range(ds[0],19,-10)): errs.append(("gap",r))
        fs=ds[0] if ds and not (len(ds)==1 and s[str(ds[0])]==0) else 0
        exp=round((r["depth"]-fs)*60/30)
        if fs and abs(exp-r["first_stop_s"])>0: errs.append(("firststop",r["depth"],r["bt"],fs,exp,r["first_stop_s"]))
        if not fs and r["first_stop_s"]!=r["depth"]*2: errs.append(("nostop",r["depth"],r["bt"]))
        tot=r["first_stop_s"]+sum(s.values())*60+(40 if fs else 0)
        if tot!=a["total_ascent_s"]: errs.append(("total",r["depth"],r["bt"],tot,a["total_ascent_s"]))
        if "air_o2" not in r: errs.append(("noo2",r["depth"],r["bt"]))
        if r.get("chamber_o2_periods") is None: errs.append(("noperiods",r["depth"],r["bt"]))

    return {"t96": t96, "t97": t97, "rnt": rnt, "si": si, "t99": out}, errs


def main():
    pages = sys.argv[1]
    got, errs = extract(pages)
    for e in errs: print("ERR", e)
    if errs: sys.exit(1)
    if sys.argv[2] == "--check":
        data = json.load(open(sys.argv[3], encoding="utf-8"))
        bad = 0
        for k in ("t96", "t97", "rnt", "si", "t99"):
            a = json.dumps(data["tables"][k], sort_keys=True); b = json.dumps(got[k], sort_keys=True)
            if a != b: print("DIFFERS from the manual:", k); bad += 1
            else: print("matches the manual:", k)
        sys.exit(1 if bad else 0)
    json.dump(got, open(sys.argv[2], "w", encoding="utf-8"), sort_keys=True)
    print("tables: 9-6 %d groups, 9-7 %d depths, 9-8 %d depths, 9-9 %d schedules" % (len(got["t96"]), len(got["t97"]), len(got["rnt"]), len(got["t99"])))


if __name__ == "__main__":
    main()
