#!/usr/bin/env python3
"""Build Trade Desk from src/ into ../index.html (Home Screen app) and, with --artifact PATH, the claude.ai version."""
import json, os, sys, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__))
rd = lambda f: open(os.path.join(HERE, f), encoding='utf-8').read()
def opt_json(f, default):
    p = os.path.join(HERE, f)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else default
core, feat, rook, ui2, sync = rd('core.js'), rd('features.js'), rd('rookies.js'), rd('ui2.js'), rd('sync.js')
bm = 'javascript:' + urllib.parse.quote(rd('bookmarklet.js'), safe='')
live = json.dumps(opt_json('rookie_stats.json', None), separators=(',', ':'), ensure_ascii=False)
news = json.dumps(opt_json('news.json', {'items': []}), separators=(',', ':'), ensure_ascii=False)
def make(pwa):
    ui = rd('ui.js')
    ui = (ui.replace('__SEED_R__', json.dumps(rd('seed_redraft.txt'))).replace('__SEED_D__', json.dumps(rd('seed_dynasty.txt')))
            .replace('__BM__', json.dumps(bm)).replace('__PWA__', 'true' if pwa else 'false').replace('__NEWS__', news))
    r = rook.replace('__ROOKIE_LIVE__', live)
    html = rd('app.template.html').replace('/*CORE*/', core).replace('/*ROOKIES*/', feat + '\n' + r + '\n' + sync + '\n' + ui2).replace('/*UI*/', ui)
    assert '</script' not in core + ui + feat + r + ui2 + sync
    if pwa:
        html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
        html = html.replace('<meta name="theme-color" content="#000000">', '''<meta name="theme-color" content="#000000">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Trade Desk">
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" href="icon-192.png">''')
        html = html.replace('<title>Fantasy Trade Desk</title>', '<title>Trade Desk</title>')
        html = html.replace('</style>', '.top { padding-top: calc(12px + env(safe-area-inset-top)); padding-left: calc(16px + env(safe-area-inset-left)); padding-right: calc(16px + env(safe-area-inset-right)); }\n</style>')
        html = html.replace('</body>', "<script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});</script>\n</body>")
    return html
open(os.path.join(HERE, '..', 'index.html'), 'w', encoding='utf-8').write(make(True))
if '--artifact' in sys.argv:
    open(sys.argv[sys.argv.index('--artifact') + 1], 'w', encoding='utf-8').write(make(False))
print('built index.html')
