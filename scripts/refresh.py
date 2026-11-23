#!/usr/bin/env python3
"""Daily data refresh for Trade Desk.

Pulls fresh FantasyCalc values (the app's starting values before a league sync)
and every scouting prospect's current size, class and season stats from ESPN,
then writes them into src/. The build step turns src/ into index.html.
Each source is optional: if one is down, the last good data stays in place.
"""
import json, os, re, sys, time, urllib.parse, urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
UA = {'User-Agent': 'Mozilla/5.0 (TradeDesk daily refresh)'}
SEASON = date.today().year if date.today().month >= 3 else date.today().year - 1


def get_json(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                print('  failed:', url, e, file=sys.stderr)
                return None
            time.sleep(2 * (i + 1))


def refresh_values():
    """FantasyCalc 1QB, 12-team PPR values in the app's seed format."""
    for dyn, fname in ((False, 'seed_redraft.txt'), (True, 'seed_dynasty.txt')):
        j = get_json('https://api.fantasycalc.com/values/current?isDynasty=%s&numQbs=1&numTeams=12&ppr=1' % ('true' if dyn else 'false'))
        if not isinstance(j, list) or len(j) < 100:
            print('FantasyCalc', fname, 'unavailable; keeping previous file')
            continue
        lines = []
        for x in j:
            p = x.get('player') or {}
            if not x.get('value'):
                continue
            lines.append('|'.join(str(v) for v in [p.get('name', ''), p.get('position', ''), p.get('maybeTeam') or '', p.get('espnId') or '',
                                                   x['value'], p.get('maybeAge') or '', x.get('trend30Day') or 0]))
        open(os.path.join(SRC, fname), 'w').write('\n'.join(lines) + '\n')
        print('FantasyCalc', fname, len(lines), 'players')


def num(s):
    try:
        return float(str(s).replace(',', ''))
    except ValueError:
        return 0.0


def fmt_int(v):
    return '{:,}'.format(int(round(v)))


def season_line(categories, season):
    """Pick the given season's row for each stat category, keyed by label."""
    out = {}
    for c in categories or []:
        rows = [r for r in c.get('statistics', []) if (r.get('season') or {}).get('year') == season]
        if rows:
            out[c['name']] = dict(zip(c.get('labels', []), rows[-1].get('stats', [])))
    return out


def stat_text(pos, cats):
    p, r, c = cats.get('passing'), cats.get('rushing'), cats.get('receiving')
    if pos == 'QB' and p:
        s = '%s yds · %s TD · %s INT' % (fmt_int(num(p.get('YDS'))), int(num(p.get('TD'))), int(num(p.get('INT'))))
        if r and num(r.get('YDS')) >= 300:
            s += ' · %s rush yds' % fmt_int(num(r.get('YDS')))
        if r and num(r.get('TD')) >= 3:
            s += ' · %s rush TD' % int(num(r.get('TD')))
        return s
    if pos == 'RB' and r:
        s = '%s car · %s yds · %s TD' % (int(num(r.get('CAR'))), fmt_int(num(r.get('YDS'))), int(num(r.get('TD'))))
        if c and num(c.get('REC')) >= 15:
            s += ' · %s rec' % int(num(c.get('REC')))
        return s
    if pos in ('WR', 'TE') and c:
        return '%s rec · %s yds · %s TD' % (int(num(c.get('REC'))), fmt_int(num(c.get('YDS'))), int(num(c.get('TD'))))
    return None


CLASS = {'Freshman': 'Fr', 'Sophomore': 'So', 'Junior': 'Jr', 'Senior': 'Sr', 'Graduate Student': 'Gr'}


def prospect(name, pos, school, fetch=get_json):
    s = fetch('https://site.web.api.espn.com/apis/search/v2?limit=15&type=player&query=' + urllib.parse.quote(name))
    if not s:
        return None
    hits = [x for r in s.get('results', []) for x in r.get('contents', []) if x.get('description') == 'NCAAF']
    words = [w for w in school.lower().split() if len(w) > 2]
    hit = next((x for x in hits if words and all(w in (x.get('subtitle') or '').lower() for w in words)), None)
    if not hit:
        return None
    aid = hit['uid'].split('a:')[1]
    a = fetch('https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes/' + aid) or {}
    at = a.get('athlete', a)
    st = fetch('https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes/' + aid + '/stats') or {}
    out = {'espn': aid}
    line = stat_text(pos, season_line(st.get('categories'), SEASON))
    if line:
        out['stats'] = line
    if at.get('displayHeight'):
        out['ht'] = at['displayHeight'].replace("' ", "'")
    w = re.match(r'(\d+)', at.get('displayWeight') or '')
    if w:
        out['wt'] = int(w.group(1))
    if CLASS.get(at.get('displayExperience')):
        out['cls'] = CLASS[at['displayExperience']]
    return out


def refresh_prospects():
    js = open(os.path.join(SRC, 'rookies.js')).read()
    rows = re.findall(r"^  \['((?:[^'\\]|\\.)*)', '(QB|RB|WR|TE)', '((?:[^'\\]|\\.)*)'", js, re.M)
    path = os.path.join(SRC, 'rookie_stats.json')
    old = json.load(open(path)) if os.path.exists(path) else {}
    new = {}
    for name, pos, school in rows:
        name, school = name.replace("\\'", "'"), school.replace("\\'", "'")
        try:
            got = prospect(name, pos, school)
        except Exception as e:  # noqa: BLE001
            print('  error', name, e, file=sys.stderr)
            got = None
        new[name] = got or (old.get('players') or {}).get(name) or {}
        time.sleep(0.3)
    found = sum(1 for v in new.values() if v.get('stats'))
    if found < len(rows) * 0.5:
        print('ESPN prospect data looks incomplete (%d of %d); keeping previous file' % (found, len(rows)))
        return
    json.dump({'asOf': date.today().isoformat(), 'season': SEASON, 'players': new}, open(path, 'w'), indent=1, ensure_ascii=False)
    print('Prospects updated:', found, 'of', len(rows))


if __name__ == '__main__':
    refresh_values()
    refresh_prospects()
