import sys,re,html
b=open(sys.argv[1],'rb').read().decode('utf-8','replace')
b=re.sub(r'(?is)<(script|style|noscript)[^>]*>.*?</\1>',' ',b)
b=re.sub(r'(?i)<br\s*/?>|</(p|div|li|h\d|tr|td|th)>','\n',b)
b=re.sub(r'(?s)<[^>]+>',' ',b)
b=html.unescape(b)
b=re.sub(r'[ \t ]+',' ',b); b=re.sub(r'\n\s*\n+','\n',b)
print(b)
