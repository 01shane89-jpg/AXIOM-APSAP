import json,re,sys
for f in sys.argv[1:]:
  for x in json.load(open(f)):
    t=' '.join(str(x.get(k) or '') for k in ('title','detail','place','attribution','target','victims'))
    hits=re.findall(r'(?:\+66|0)\d{1,2}[ -]?\d{3}[ -]?\d{4}|\b\d{10,}\b|[\w.]+@\w+|\b(?:Mr|Ms|Mrs|Miss|Pol\.? ?\w*|Lt|Gen|Col)\.? [A-Z]\w+(?: [A-Z]\w+)?|\b[A-Z][a-z]+ (?:[A-Z][a-z]+ ){0,1}[A-Z][a-z]+(?:,? (?:aged? )?\d{2})',t)
    if hits: print(f,x['date'],x['title'],'|',hits)
