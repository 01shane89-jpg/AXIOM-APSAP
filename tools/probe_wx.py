import json, urllib.request, collections
LEV=[1000,950,900,850,800,700,600,500]
HV="temperature_2m,dew_point_2m,precipitation,weather_code,cloud_cover,cloud_cover_low,visibility,wind_speed_10m,wind_gusts_10m,cape,lifted_index".split(",")+["cloud_cover_%dhPa"%l for l in LEV]+["geopotential_height_%dhPa"%l for l in LEV]
PTS=[("Bangkok",13.75,100.5),("Chiang Mai",18.79,98.98),("Khon Kaen",16.43,102.83),("Hat Yai",7.0,100.47),("Phuket",7.88,98.39)]
def get(model):
    u="https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s&hourly=%s&timeformat=unixtime&timezone=GMT&wind_speed_unit=kn&forecast_days=3%s"%(",".join(str(p[1]) for p in PTS),",".join(str(p[2]) for p in PTS),",".join(HV),model)
    return json.load(urllib.request.urlopen(u,timeout=60))
for model in ["", "&models=gfs_seamless", "&models=ecmwf_ifs025"]:
  print("=== model", model or "best_match")
  for (nm,_,_),j in zip(PTS,get(model)):
    h=j["hourly"]; el=j.get("elevation",0); n=len(h["time"])
    c=collections.Counter()
    vis=[v for v in h["visibility"] if v is not None]
    ceil=[]; lcl=[]
    for i in range(n):
        code=h["weather_code"][i]; c["code95+"]+= code is not None and code>=95
        best=None
        for l in LEV:
            cc=h["cloud_cover_%dhPa"%l][i]; z=h["geopotential_height_%dhPa"%l][i]
            if cc is None or z is None: continue
            agl=z-el
            if agl<0 or cc<60: continue
            best=agl if best is None else min(best,agl)
        t=h["temperature_2m"][i]; td=h["dew_point_2m"][i]; low=h["cloud_cover_low"][i]
        if best is None and low is not None and low>=60 and t is not None and td is not None: best=max(60,125*(t-td)); c["lclfallback"]+=1
        if best is not None:
            ft=best*3.281; ceil.append(ft)
            if ft<500: c["ceil<500"]+=1
            if ft<1000: c["ceil<1000"]+=1
            lv=[l for l in LEV if h["cloud_cover_%dhPa"%l][i] is not None and h["cloud_cover_%dhPa"%l][i]>=60]
            if lv and lv[0]==1000: c["lvl1000"]+=1
        if h["visibility"][i] is not None and h["visibility"][i]<1600: c["vis<1600"]+=1
        if h["visibility"][i] is not None and h["visibility"][i]<5000: c["vis<5000"]+=1
        g=h["wind_gusts_10m"][i]
        if g is not None and g>=30: c["gust>=30"]+=1
        if (h["cape"][i] or 0)>=1000: c["cape>=1000"]+=1
    print(nm, "elev",el,"hours",n, dict(c), "minvis",min(vis) if vis else None, "minceil",round(min(ceil)) if ceil else None, "codes",sorted(collections.Counter(h["weather_code"]).items()))
