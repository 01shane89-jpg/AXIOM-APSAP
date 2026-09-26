"""Write build output (one <script> block per layer, on stdin) to data/layers/<cc>/<layer>.js."""
import re, sys, os
for body in re.findall(r"<script>(.*?)</script>", sys.stdin.read(), re.S):
    k = re.match(r'\s*window\.TSAP_DATA=window\.TSAP_DATA\|\|\{\};window\.TSAP_DATA\["([a-z]+)(?:/([a-z]+))?"\]', body)
    cc, lid = (k.group(1), k.group(2)) if k.group(2) else ("th", k.group(1))
    path = "data/layers/%s/%s.js" % (cc, lid)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8").write(body.strip() + "\n")
    print("wrote", path)
