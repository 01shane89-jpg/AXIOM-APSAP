import json,glob,os,sys
page=sys.argv[1]; D="source/sof"
h=open(page).read()
blocks=[]
for f in sorted(glob.glob(D+"/*.json")):
  n=os.path.basename(f)[:-5]
  if n=="exercises-outside": continue
  j=json.load(open(f)); p=json.dumps(j,ensure_ascii=True,separators=(",",":")).replace("</","<\\/")
  blocks.append('<script>window.ASAP_SOF=window.ASAP_SOF||{};window.ASAP_SOF[%s]=%s;</script>'%(json.dumps(n),p))
j=json.load(open(D+"/exercises-outside.json"))
blocks.append('<script>window.ASAP_SOF_OUT=%s;</script>'%json.dumps(j,ensure_ascii=True,separators=(",",":")).replace("</","<\\/"))
m='<script>window.COUNTRY_BASE='
assert h.count(m)==1 and 'window.ASAP_SOF["' not in h
h=h.replace(m,"\n".join(blocks)+"\n"+m)
open(page,"w").write(h); print(len(blocks))
