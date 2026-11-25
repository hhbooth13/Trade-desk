/* ---------- Built-in sync for the Home Screen app (public ESPN leagues, no login needed) ---------- */
const ESPN = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
/* Always ask ESPN for fresh league data; never reuse a copy the phone cached from an earlier sync. */
const NOCACHE = { cache: 'no-store' };
function parseLeagueId(s) {
  const m = String(s || '').match(/leagueId=(\d+)/i) || String(s || '').match(/^\s*(\d{3,})\s*$/);
  return m ? m[1] : null;
}
async function fcValues(qbs, n, ppr) {
  const t = Math.min(16, Math.max(8, Math.round(n / 2) * 2));
  const one = async (dyn, teams) => {
    try {
      const j = await (await fetch('https://api.fantasycalc.com/values/current?isDynasty=' + dyn + '&numQbs=' + qbs + '&numTeams=' + teams + '&ppr=' + ppr)).json();
      if (!Array.isArray(j) || !j.length) return null;
      return j.filter(x => x.value > 0).map(x => [x.player.name, x.player.position, x.player.maybeTeam || '', x.player.espnId || '', x.value, x.player.maybeAge || '', x.trend30Day || 0].join('|')).join('\n');
    } catch (e) { return null; }
  };
  let r = await one(false, t), d = await one(true, t);
  if (!r) r = await one(false, 12);
  if (!d) d = await one(true, 12);
  return r ? { asOf: Date.now(), qbs, teams: t, ppr, redraft: r, dynasty: d } : null;
}
/* Turn ESPN transaction lists and league-activity messages into one deduped trade list.
   Trades still in the league's review period are kept and marked pending. */
/* Team picture URLs: ESPN stores whatever the manager entered, so accept //host/..., bare host/..., and http links. */
function normLogo(u) {
  u = String(u || '').trim();
  if (!u || /^data:|^javascript:/i.test(u)) return '';
  if (u.startsWith('//')) u = 'https:' + u;
  else if (!/^https?:\/\//i.test(u)) { if (/^[\w-]+(\.[\w-]+)+\//.test(u)) u = 'https://' + u; else return ''; }
  return u;
}
function tradeKey(items) { return items.map(i => i.join(':')).sort().join(','); }
function collectTrades(txs, topics) {
  const out = [], seen = new Set();
  const add = (d, items, pending, proc) => {
    if (!items.length) return;
    const k = tradeKey(items);
    const prev = out.find(x => x.k === k);
    if (prev) { if (!pending) prev.pending = false; else if (proc && !prev.proc) prev.proc = proc; return; }
    out.push({ k, d, items, pending: !!pending, proc: proc || 0 });
  };
  (txs || []).forEach(t => {
    if (!/TRADE_(ACCEPT|UPHOLD|PROPOSAL)/.test(t.type || '') && t.type !== 'TRADE') return;
    const st = t.status || 'EXECUTED';
    if (/CANCEL|REJECT|VETO|FAIL|DECLINE/.test(st)) return;
    if (t.type === 'TRADE_PROPOSAL' && st !== 'EXECUTED' && st !== 'PENDING' && st !== 'ACCEPTED') return;
    if (t.type === 'TRADE_PROPOSAL' && st === 'PENDING') return;
    const items = (t.items || []).filter(i => i.type === 'TRADE' || (i.fromTeamId > 0 && i.toTeamId > 0)).map(i => [i.playerId, i.fromTeamId, i.toTeamId]);
    /* Accepted but not yet processed: show it as in review, with ESPN's processing time. */
    const pend = st !== 'EXECUTED' && (!t.processDate || t.processDate > Date.now());
    add(pend ? (t.proposedDate || t.processDate || 0) : (t.processDate || t.proposedDate || 0), items, pend, pend ? t.processDate || 0 : 0);
  });
  (topics || []).forEach(tp => {
    const ms = (tp.messages || []).filter(x => x.messageTypeId === 244 && x.targetId);
    if (!ms.length) return;
    const froms = [...new Set(ms.map(x => x.from).filter(x => x > 0))];
    const items = ms.map(x => [x.targetId, x.from, x.to > 0 ? x.to : (froms.length === 2 ? froms.find(f => f !== x.from) : 0)]).filter(i => i[1] > 0 && i[2] > 0);
    add(tp.date || (ms[0] && ms[0].date) || 0, items, false);
  });
  return out.map(x => ({ d: x.d, items: x.items, pending: x.pending || undefined, processes: x.pending && x.proc ? x.proc : undefined }));
}
async function espnSync(id, progress) {
  progress = progress || (() => {});
  const now = new Date();
  const yr = now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
  const base = ESPN + '/seasons/' + yr + '/segments/0/leagues/' + id;
  progress('Reading league from ESPN…');
  const r = await fetch(base + '?view=mTeam&view=mRoster&view=mSettings&view=mMatchupScore', NOCACHE);
  if (r.status === 401 || r.status === 403) throw new Error('This league is private. Ask your commissioner to turn on “League Viewable to Public” in ESPN league settings, then sync again.');
  if (r.status === 404) throw new Error('ESPN has no league with ID ' + id + ' for ' + yr + '. Check the ID.');
  if (!r.ok) throw new Error('ESPN answered ' + r.status + '. Try again in a minute.');
  const L = await r.json();
  const S = L.settings || {}, slots = (S.rosterSettings || {}).lineupSlotCounts || {};
  const rec = ((S.scoringSettings || {}).scoringItems || []).find(i => i.statId === 53);
  const pts = rec ? (rec.points || (rec.pointsOverrides && Object.values(rec.pointsOverrides)[0]) || 0) : 0;
  const ppr = pts >= 0.75 ? 1 : pts >= 0.25 ? 0.5 : 0;
  const mem = {};
  (L.members || []).forEach(m => { mem[m.id] = ((m.firstName || '') + ' ' + (m.lastName || '')).trim() || m.displayName || ''; });
  const r1 = x => x == null ? null : Math.round(x * 10) / 10;
  const teams = (L.teams || []).map(t => {
    const o = (t.record || {}).overall || {};
    return {
      id: t.id, name: t.name || ((t.location || '') + ' ' + (t.nickname || '')).trim() || ('Team ' + t.id), abbrev: t.abbrev || '', logo: normLogo(t.logo),
      owner: (t.owners || []).map(x => mem[x]).filter(Boolean).join(', '), mine: false,
      w: o.wins || 0, l: o.losses || 0, t: o.ties || 0, pf: Math.round(o.pointsFor || 0),
      roster: ((t.roster || {}).entries || []).map(e => {
        const p = (e.playerPoolEntry || {}).player || {};
        const st = p.stats || [];
        const pj = st.find(s => s.scoringPeriodId === L.scoringPeriodId && s.statSourceId === 1 && s.statSplitTypeId === 1);
        const sa = st.find(s => s.scoringPeriodId === 0 && s.statSourceId === 0 && s.statSplitTypeId === 0 && (!s.seasonId || s.seasonId === yr));
        return [e.playerId, p.fullName || '', p.defaultPositionId || 0, p.proTeamId || 0, e.lineupSlotId, p.injuryStatus || '', p.ownership && p.ownership.percentOwned != null ? r1(p.ownership.percentOwned) : null, pj ? r1(pj.appliedTotal) : null, sa ? r1(sa.appliedAverage) : null];
      })
    };
  });
  if (!teams.length) throw new Error('ESPN returned no teams for this league.');
  progress('Loading free agents and NFL schedule…');
  let fa = null, nfl = null;
  const trades = [];
  try {
    const filter = { players: { filterStatus: { value: ['FREEAGENT', 'WAIVERS'] }, filterSlotIds: { value: [0, 2, 4, 6, 16, 17] }, limit: 150, sortPercOwned: { sortPriority: 1, sortAsc: false } } };
    const fr = await fetch(base + '?view=kona_player_info', { cache: 'no-store', headers: { 'x-fantasy-filter': JSON.stringify(filter) } });
    if (fr.ok) fa = ((await fr.json()).players || []).map(x => { const p = x.player || {}; return [x.id || p.id, p.fullName || '', p.defaultPositionId || 0, p.proTeamId || 0, x.status === 'WAIVERS' ? 1 : 0, p.injuryStatus || '', p.ownership && p.ownership.percentOwned != null ? r1(p.ownership.percentOwned) : null]; });
  } catch (e) {}
  try {
    const sj = await (await fetch(ESPN + '/seasons/' + yr + '?view=proTeamSchedules_wl')).json();
    const tn = {};
    ((sj.settings || {}).proTeams || []).forEach(t => {
      if (!t.id) return;
      const g = {};
      Object.keys(t.proGamesByScoringPeriod || {}).forEach(w => { const x = t.proGamesByScoringPeriod[w][0]; if (x) g[w] = x.homeProTeamId === t.id ? x.awayProTeamId : x.homeProTeamId; });
      tn[t.id] = { a: String(t.abbrev || '').toUpperCase(), bye: t.byeWeek, g };
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
    nfl = { teams: tn, pa };
  } catch (e) {}
  progress('Loading trade history…');
  try {
    const weeks = [];
    for (let w = 1; w <= (L.scoringPeriodId || 1) + 1; w++) weeks.push(w);
    const txs = [].concat(...await Promise.all(weeks.map(async w => {
      try { const tr = await fetch(base + '?view=mTransactions2&scoringPeriodId=' + w, NOCACHE); return tr.ok ? ((await tr.json()).transactions || []) : []; } catch (e) { return []; }
    })));
    /* Accepted trades still in the league's review period only show up in ESPN's pending-transactions view. */
    try {
      const pr = await fetch(base + '?view=mPendingTransactions', NOCACHE);
      if (pr.ok) { const pj = await pr.json(); [].concat(pj.pendingTransactions || [], pj.transactions || []).forEach(t => txs.push(t)); }
    } catch (e) {}
    let topics = [];
    try {
      const cr = await fetch(base + '/communication/?view=kona_league_communication', { cache: 'no-store', headers: { 'x-fantasy-filter': '{"topics":{"filterType":{"value":["ACTIVITY_TRANSACTIONS"]},"limit":250,"limitPerMessageSet":{"value":50},"offset":0,"sortMessageDate":{"sortPriority":1,"sortAsc":false},"sortFor":{"sortPriority":2,"sortAsc":false},"filterIncludeMessageTypeIds":{"value":[244]}}}' } });
      if (cr.ok) topics = (await cr.json()).topics || [];
    } catch (e) {}
    collectTrades(txs, topics).forEach(t => trades.push(t));
  } catch (e) {}
  const qbs = (slots['7'] || 0) > 0 ? 2 : 1;
  progress('Loading FantasyCalc values…');
  const values = await fcValues(qbs, S.size || teams.length, ppr);
  return {
    ffo: 2,
    league: {
      id: String(L.id || id), season: yr, name: S.name || ('League ' + id), size: S.size || teams.length,
      ppr, qbs, slots, keepers: (S.draftSettings || {}).keeperCount || 0, week: L.scoringPeriodId || 0, teams,
      sched: { reg: (S.scheduleSettings || {}).matchupPeriodCount || 14, poLen: (S.scheduleSettings || {}).playoffMatchupPeriodLength || 1, poTeams: (S.scheduleSettings || {}).playoffTeamCount || 4 },
      mp: (L.status || {}).currentMatchupPeriod || 0,
      sch: (L.schedule || []).filter(g => g.home && g.away).map(g => [g.matchupPeriodId, g.home.teamId, g.away.teamId, r1(g.home.totalPoints || 0), r1(g.away.totalPoints || 0), g.winner === 'HOME' ? 1 : g.winner === 'AWAY' ? 2 : g.winner === 'TIE' ? 3 : 0]),
      nfl, trades, players: Object.fromEntries([].concat(...teams.map(t => t.roster.map(r => [r[0], [r[1], r[2]]])))), fa
    },
    values
  };
}
