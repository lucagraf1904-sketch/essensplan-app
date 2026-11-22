#!/bin/sh
# Baut die Demo nach $1 (Standard: /home/user/demo-build): App-Dateien + demo.js/demo.css/plan.js (Beispiel-Essensplan).
OUT=${1:-/home/user/demo-build}; D=$(cd "$(dirname "$0")" && pwd); SRC="$D/.."
rm -rf "$OUT"; mkdir -p "$OUT"
cp "$SRC"/*.js "$SRC"/*.css "$SRC"/icon.svg "$SRC"/manifest.webmanifest "$OUT"/
cp "$D"/demo.js "$D"/demo.css "$D"/plan.js "$OUT"/
python3 - "$SRC/index.html" "$OUT/index.html" <<'PY'
import sys
s = open(sys.argv[1]).read()
def rep(a, b):
    global s
    assert s.count(a) == 1, a
    s = s.replace(a, b)
rep('<link rel="stylesheet" href="style.css">', '<link rel="stylesheet" href="style.css">\n  <link rel="stylesheet" href="demo.css">\n  <script src="demo.js"></script>')
rep('<title>Speisekammer</title>', '<title>Speisekammer (Demo)</title>')
rep('<button data-tab="shop">', '<button data-tab="plan">📅<span>Plan</span></button>\n    <button data-tab="shop">')
rep('    <!-- Tab: Einkauf -->', '    <!-- Tab: Essensplan (nur Demo) -->\n    <section id="tab-plan" class="tab"></section>\n\n    <!-- Tab: Einkauf -->')
rep('</body>', '  <script type="module" src="plan.js"></script>\n</body>')
open(sys.argv[2], 'w').write(s)
PY
