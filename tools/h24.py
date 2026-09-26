"""Convert 12-hour clock times (4pm, 8:50 p.m., 3.32pm) in record text to 24-hour (16:00, 20:50, 15:32)."""
import re
R=re.compile(r'\b(\d{1,2})(?:[:.](\d{2}))?\s?(a\.m\.|p\.m\.|am|pm|AM|PM)(?![A-Za-z])')
def conv(s):
    def f(m):
        h=int(m.group(1)); mi=m.group(2) or "00"; ap=m.group(3).lower().replace('.','')
        if h<1 or h>12: return m.group(0)
        if ap=='am': h=0 if h==12 else h
        else: h=12 if h==12 else h+12
        out="%02d:%s"%(h,mi)
        if m.group(3).endswith('.'):
            rest=m.string[m.end():]
            if rest=="" or re.match(r'\s+[A-Z"]',rest): out+="."
        return out
    return R.sub(f,s)
if __name__=="__main__":
    for t in ["was restored by 8:50 p.m. The city","ended 8:50 p.m.","8:50 p.m.","12pm","12 a.m.","around 4pm.","11 a.m. Sunday","at 6:52 p.m. during"]: print(t,'->',conv(t))
