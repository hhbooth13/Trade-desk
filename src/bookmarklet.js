(async () => {
/* Team picture URLs: ESPN stores whatever the manager entered, so accept //host/..., bare host/..., and http links. */
function normLogo(u) {
  u = String(u || '').trim();
  if (!u || /^data:|^javascript:/i.test(u)) return '';
  if (u.startsWith('//')) u = 'https:' + u;
  else if (!/^https?:\/\//i.test(u)) { if (/^[\w-]+(\.[\w-]+)+\//.test(u)) u = 'https://' + u; else return ''; }
  return u;
}
/* Turn ESPN transaction lists and league-activity messages into one deduped trade list.
   Trades still in the league's review period are kept and marked pending. */
function tradeKey(items) { return items.map(i => i.join(':')).sort().join(','); }
function collectTrades(txs, topics) {
  const out = [], seen = new Set();
  const add = (d, items, pending) => {
    if (!items.length) return;
    const k = tradeKey(items);
    const prev = out.find(x => x.k === k);
    if (prev) { if (!pending) prev.pending = false; return; }
    out.push({ k, d, items, pending: !!pending });
  };
  (txs || []).forEach(t => {
    if (!/TRADE_(ACCEPT|UPHOLD|PROPOSAL)/.test(t.type || '') && t.type !== 'TRADE') return;
    const st = t.status || 'EXECUTED';
    if (/CANCEL|REJECT|VETO|FAIL|DECLINE/.test(st)) return;
    if (t.type === 'TRADE_PROPOSAL' && st !== 'EXECUTED' && st !== 'PENDING' && st !== 'ACCEPTED') return;
    if (t.type === 'TRADE_PROPOSAL' && st === 'PENDING') return;
    const items = (t.items || []).filter(i => i.type === 'TRADE' || (i.fromTeamId > 0 && i.toTeamId > 0)).map(i => [i.playerId, i.fromTeamId, i.toTeamId]);
    add(t.processDate || t.proposedDate || 0, items, st !== 'EXECUTED');
  });
  (topics || []).forEach(tp => {
    const ms = (tp.messages || []).filter(x => x.messageTypeId === 244 && x.targetId);
    if (!ms.length) return;
    const froms = [...new Set(ms.map(x => x.from).filter(x => x > 0))];
    const items = ms.map(x => [x.targetId, x.from, x.to > 0 ? x.to : (froms.length === 2 ? froms.find(f => f !== x.from) : 0)]).filter(i => i[1] > 0 && i[2] > 0);
    add(tp.date || (ms[0] && ms[0].date) || 0, items, false);
  });
  return out.map(x => ({ d: x.d, items: x.items, pending: x.pending || undefined }));
}
  const H = location.hostname, P = new URLSearchParams(location.search);
  const css = 'all:initial;position:fixed;z-index:2147483647;top:16px;right:16px;width:360px;max-width:calc(100vw - 32px);background:#101827;color:#eef2f7;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.45);border:1px solid #2b3a52;box-sizing:border-box';
  const btn = 'all:initial;cursor:pointer;font:600 14px system-ui,sans-serif;padding:9px 14px;border-radius:8px;margin:10px 8px 0 0;display:inline-block';
  const box = (title, text, data) => {
    let d = document.getElementById('ffo-sync');
    if (d) d.remove();
    d = document.createElement('div');
    d.id = 'ffo-sync';
    d.style.cssText = css;
    const h = document.createElement('div');
    h.style.cssText = 'all:initial;display:block;font:700 16px system-ui,sans-serif;color:#ff8a3d;margin-bottom:6px';
    h.textContent = title;
    const p = document.createElement('div');
    p.style.cssText = 'all:initial;display:block;font:14px/1.45 system-ui,sans-serif;color:#eef2f7';
    p.textContent = text;
    d.append(h, p);
    if (data) {
      const c = document.createElement('button');
      c.style.cssText = btn + ';background:#ff8a3d;color:#101827';
      c.textContent = 'Copy league data';
      const ta = document.createElement('textarea');
      ta.value = data;
      ta.readOnly = true;
      ta.style.cssText = 'all:initial;display:block;width:100%;height:60px;margin-top:10px;font:11px monospace;background:#0a101b;color:#9fb0c6;border:1px solid #2b3a52;border-radius:6px;padding:6px;box-sizing:border-box';
      c.onclick = async () => {
        let ok = false;
        try { await navigator.clipboard.writeText(data); ok = true; } catch (e) {
          ta.select();
          try { ok = document.execCommand('copy'); } catch (e2) {}
        }
        c.textContent = ok ? 'Copied! Now paste it into the app' : 'Select the box below and copy it';
      };
      d.append(c);
      d.append(ta);
    }
    const x = document.createElement('button');
    x.style.cssText = btn + ';background:#26354d;color:#eef2f7';
    x.textContent = 'Close';
    x.onclick = () => d.remove();
    d.append(x);
    document.body.appendChild(d);
  };
  const fc = async (dyn, qbs, n, ppr) => {
    try {
      const r = await fetch('https://api.fantasycalc.com/values/current?isDynasty=' + dyn + '&numQbs=' + qbs + '&numTeams=' + n + '&ppr=' + ppr);
      const j = await r.json();
      if (!Array.isArray(j) || !j.length) return null;
      return j.filter(x => x.value > 0).map(x => [x.player.name, x.player.position, x.player.maybeTeam || '', x.player.espnId || '', x.value, x.player.maybeAge || '', x.trend30Day || 0].join('|')).join('\n');
    } catch (e) { return null; }
  };
  const values = async (qbs, n, ppr) => {
    const t = Math.min(16, Math.max(8, Math.round(n / 2) * 2));
    let r = await fc(false, qbs, t, ppr), d = await fc(true, qbs, t, ppr);
    if (!r || !d) { r = r || await fc(false, qbs, 12, ppr); d = d || await fc(true, qbs, 12, ppr); }
    return { asOf: Date.now(), qbs, teams: t, ppr, redraft: r, dynasty: d };
  };
  try {
    if (!/(^|\.)espn\.com$/.test(H)) {
      box('Getting trade values…', 'Loading the latest FantasyCalc values.');
      const v = await values(1, 12, 1);
      if (!v.redraft) return box('Could not reach FantasyCalc', 'Check your internet connection and click the bookmark again.');
      return box('Trade values ready', 'This copies FantasyCalc values only (12-team, PPR). To sync your rosters too, open your ESPN league and click the bookmark there.', JSON.stringify({ ffo: 2, values: v }));
    }
    const id = P.get('leagueId');
    if (!id) return box('Open your league first', 'Go to a page in your ESPN fantasy football league (its address contains leagueId=), then click this bookmark again.');
    let yr = +P.get('seasonId') || 0;
    if (!yr) { const n = new Date(); yr = n.getMonth() < 2 ? n.getFullYear() - 1 : n.getFullYear(); }
    box('Syncing…', 'Reading your league from ESPN.');
    const path = '/apis/v3/games/ffl/seasons/' + yr + '/segments/0/leagues/' + id + '?view=mTeam&view=mRoster&view=mSettings&view=mMatchupScore';
    let L = null, status = 0, hostOK = 'https://lm-api-reads.fantasy.espn.com';
    for (const host of ['https://lm-api-reads.fantasy.espn.com', 'https://fantasy.espn.com']) {
      try {
        const r = await fetch(host + path, { credentials: 'include' });
        status = r.status;
        if (r.ok) { L = await r.json(); hostOK = host; break; }
      } catch (e) {}
    }
    if (!L || !L.teams) return box('ESPN would not share this league (' + (status || 'network error') + ')', 'Make sure you are logged in to ESPN with an account that is in this league, then try again.');
    const S = L.settings || {}, slots = (S.rosterSettings || {}).lineupSlotCounts || {};
    const rec = ((S.scoringSettings || {}).scoringItems || []).find(i => i.statId === 53);
    const pts = rec ? (rec.points || (rec.pointsOverrides && Object.values(rec.pointsOverrides)[0]) || 0) : 0;
    const ppr = pts >= 0.75 ? 1 : pts >= 0.25 ? 0.5 : 0;
    const mem = {};
    (L.members || []).forEach(m => { mem[m.id] = ((m.firstName || '') + ' ' + (m.lastName || '')).trim() || m.displayName || ''; });
    const sw = decodeURIComponent((document.cookie.match(/(?:^|;\s*)SWID=([^;]+)/) || [])[1] || '').toUpperCase();
    const teams = L.teams.map(t => {
      const o = (t.record || {}).overall || {};
      return {
        id: t.id,
        name: t.name || ((t.location || '') + ' ' + (t.nickname || '')).trim() || ('Team ' + t.id),
        abbrev: t.abbrev || '', logo: normLogo(t.logo),
        owner: (t.owners || []).map(x => mem[x]).filter(Boolean).join(', '),
        mine: !!sw && (t.owners || []).some(x => String(x).toUpperCase() === sw),
        w: o.wins || 0, l: o.losses || 0, t: o.ties || 0, pf: Math.round(o.pointsFor || 0),
        roster: ((t.roster || {}).entries || []).map(e => {
          const p = (e.playerPoolEntry || {}).player || {};
          const st = p.stats || [];
          const pj = st.find(s => s.scoringPeriodId === L.scoringPeriodId && s.statSourceId === 1 && s.statSplitTypeId === 1);
          const sa = st.find(s => s.scoringPeriodId === 0 && s.statSourceId === 0 && s.statSplitTypeId === 0 && (!s.seasonId || s.seasonId === yr));
          const r1 = x => x == null ? null : Math.round(x * 10) / 10;
          return [e.playerId, p.fullName || '', p.defaultPositionId || 0, p.proTeamId || 0, e.lineupSlotId, p.injuryStatus || '', p.ownership && p.ownership.percentOwned != null ? r1(p.ownership.percentOwned) : null, pj ? r1(pj.appliedTotal) : null, sa ? r1(sa.appliedAverage) : null];
        })
      };
    });
    const qbs = (slots['7'] || 0) > 0 ? 2 : 1;
    box('Syncing…', 'Got ' + teams.length + ' teams. Loading free agents, NFL schedule and trade history.');
    let fa = null;
    try {
      const filter = { players: { filterStatus: { value: ['FREEAGENT', 'WAIVERS'] }, filterSlotIds: { value: [0, 2, 4, 6, 16, 17] }, limit: 150, sortPercOwned: { sortPriority: 1, sortAsc: false } } };
      const r = await fetch(hostOK + '/apis/v3/games/ffl/seasons/' + yr + '/segments/0/leagues/' + id + '?view=kona_player_info', { credentials: 'include', headers: { 'x-fantasy-filter': JSON.stringify(filter) } });
      if (r.ok) {
        const fj = await r.json();
        fa = (fj.players || []).map(x => { const p = x.player || {}; return [x.id || p.id, p.fullName || '', p.defaultPositionId || 0, p.proTeamId || 0, x.status === 'WAIVERS' ? 1 : 0, p.injuryStatus || '', p.ownership && p.ownership.percentOwned != null ? Math.round(p.ownership.percentOwned * 10) / 10 : null]; });
      }
    } catch (e) {}
    let nfl = null, trades = [];
    try {
      const sj = await (await fetch('https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/' + yr + '?view=proTeamSchedules_wl')).json();
      const teamsN = {};
      ((sj.settings || {}).proTeams || []).forEach(t => {
        if (!t.id) return;
        const g = {};
        Object.keys(t.proGamesByScoringPeriod || {}).forEach(w => { const x = t.proGamesByScoringPeriod[w][0]; if (x) g[w] = x.homeProTeamId === t.id ? x.awayProTeamId : x.homeProTeamId; });
        teamsN[t.id] = { a: String(t.abbrev || '').toUpperCase(), bye: t.byeWeek, g };
      });
      const pa = {};
      try {
        const st = await (await fetch('https://site.api.espn.com/apis/v2/sports/football/nfl/standings')).json();
        (st.children || []).forEach(c => ((c.standings || {}).entries || []).forEach(e => {
          const v = {}; (e.stats || []).forEach(s => { v[s.name] = s.value; });
          const gp = (v.wins || 0) + (v.losses || 0) + (v.ties || 0);
          if (gp) pa[String(e.team.abbreviation).toUpperCase()] = Math.round(v.pointsAgainst / gp * 10) / 10;
        }));
      } catch (e) {}
      nfl = { teams: teamsN, pa };
    } catch (e) {}
    try {
      const txs = [];
      for (let w = 1; w <= (L.scoringPeriodId || 1) + 1; w++) {
        try { const r = await fetch(hostOK + '/apis/v3/games/ffl/seasons/' + yr + '/segments/0/leagues/' + id + '?view=mTransactions2&scoringPeriodId=' + w, { credentials: 'include' }); if (r.ok) txs.push(...((await r.json()).transactions || [])); } catch (e) {}
      }
      let topics = [];
      try { const cr = await fetch(hostOK + '/apis/v3/games/ffl/seasons/' + yr + '/segments/0/leagues/' + id + '/communication/?view=kona_league_communication', { credentials: 'include', headers: { 'x-fantasy-filter': '{"topics":{"filterType":{"value":["ACTIVITY_TRANSACTIONS"]},"limit":250,"limitPerMessageSet":{"value":50},"offset":0,"sortMessageDate":{"sortPriority":1,"sortAsc":false},"sortFor":{"sortPriority":2,"sortAsc":false},"filterIncludeMessageTypeIds":{"value":[244]}}}' } }); if (cr.ok) topics = (await cr.json()).topics || []; } catch (e) {}
      collectTrades(txs, topics).forEach(t => trades.push(t));
    } catch (e) {}
    box('Syncing…', 'Got ' + teams.length + ' teams. Loading FantasyCalc values.');
    const v = await values(qbs, S.size || teams.length, ppr);
    const out = {
      ffo: 2,
      league: {
        id: String(L.id || id), season: yr, name: S.name || ('League ' + id), size: S.size || teams.length,
        ppr, qbs, slots, keepers: (S.draftSettings || {}).keeperCount || 0, week: L.scoringPeriodId || 0, teams,
        sched: { reg: (S.scheduleSettings || {}).matchupPeriodCount || 14, poLen: (S.scheduleSettings || {}).playoffMatchupPeriodLength || 1, poTeams: (S.scheduleSettings || {}).playoffTeamCount || 4 },
        mp: (L.status || {}).currentMatchupPeriod || 0,
        sch: (L.schedule || []).filter(g => g.home && g.away).map(g => [g.matchupPeriodId, g.home.teamId, g.away.teamId, Math.round((g.home.totalPoints || 0) * 10) / 10, Math.round((g.away.totalPoints || 0) * 10) / 10, g.winner === 'HOME' ? 1 : g.winner === 'AWAY' ? 2 : g.winner === 'TIE' ? 3 : 0]),
        nfl, trades, players: Object.fromEntries([].concat(...teams.map(t => t.roster.map(r => [r[0], [r[1], r[2]]])))),
        fa: fa
      },
      values: v.redraft ? v : null
    };
    box('League ready: ' + out.league.name, teams.length + ' teams synced' + (v.redraft ? ' with fresh FantasyCalc values' : ' (FantasyCalc was unreachable, so the app will use its saved values)') + '. Copy it, then paste it into the Sync box in the app.', JSON.stringify(out));
  } catch (e) {
    box('Sync failed', String(e && e.message || e));
  }
})();
