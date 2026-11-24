/* ---------- Feature logic: trade grades, counters, block, history, planner, offseason, mock draft, rivals, records ---------- */

/* Letter grade for one side of a trade from its value edge (share of the bigger side):
   even trades are a B for both teams; winners climb to A+, losers fall to F-. */
const GRADE_STEPS = [[.35, 'A+'], [.25, 'A'], [.16, 'A-'], [.09, 'B+'], [-.03, 'B'], [-.09, 'B-'], [-.16, 'C+'], [-.25, 'C'], [-.35, 'C-'], [-.45, 'D+'], [-.55, 'D'], [-.65, 'D-'], [-.8, 'F']];
const GRADE_ORDER = ['F-', 'F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
function letterGrade(edge) { const s = GRADE_STEPS.find(([min]) => edge >= min); return s ? s[1] : 'F-'; }
/* Red (F-) through yellow (C) to green (A+). */
function gradeHue(g) { const i = GRADE_ORDER.indexOf(g), c = GRADE_ORDER.indexOf('C'); return i <= c ? Math.round(60 * i / c) : Math.round(60 + 70 * (i - c) / (GRADE_ORDER.length - 1 - c)); }

/* Trades recorded in the app's data file (src/trades.json): pick trades and others ESPN doesn't report.
   Each side's team is matched by name (team or manager, ignoring doubled letters), or else by who rosters what that side received. */
function resolveLeagueTrades(lg, teams) {
  const out = { trades: [], pickOwners: {} };
  const list = typeof LEAGUE_TRADES !== 'undefined' && Array.isArray(LEAGUE_TRADES) ? LEAGUE_TRADES : [];
  const squash = s => nk(s).replace(/(.)\1+/g, '$1');
  const toks = x => String(x || '').toLowerCase().split(/[^a-z0-9]+/).map(w => w.replace(/(.)\1+/g, '$1')).filter(w => w.length > 1);
  const close = (a, b) => a === b || (a.length > 3 && b.length > 3 && a.slice(0, 3) === b.slice(0, 3) && Math.abs(a.length - b.length) <= 2);
  const fuzzy = nm => { const q = toks(nm); if (q.length < 2) return null; let best = null, bs = 0; teams.forEach(t => { const w = toks(t.name); const hit = q.filter(x => w.some(y => close(x, y))).length / Math.max(q.length, w.length); if (hit > bs) { bs = hit; best = t; } }); return bs >= 0.6 ? best : null; };
  const byName0 = nm => { const q = squash(nm); if (!q) return null; return teams.find(t => squash(t.name) === q || squash(t.owner || '') === q) || teams.find(t => squash(t.name).includes(q) || squash(t.owner || '').split(' ').some(w => w && (w === q || w + 's' === q || q + 's' === w))) || null; };
  const byName = nm => nm === '@me' ? (teams.find(t => t.id === lg.myTeamId) || null) : byName0(nm) || fuzzy(nm);
  const holder = nm => { const k = nk(nm); for (const t of teams) for (const r of t.roster) if (nk(r[1]) === k) return { t, id: r[0] }; return null; };
  const espnId = nm => { const h = holder(nm); if (h) return h.id; const k = nk(nm); const a = typeof ALLPLAYERS !== 'undefined' && ALLPLAYERS && ALLPLAYERS.players.find(r => nk(r[1]) === k); return a ? a[0] : null; };
  list.forEach(tr => {
    if (tr.league && tr.league !== (lg.type === 'dynasty' ? 'dynasty' : 'redraft')) return;
    if (!Array.isArray(tr.sides) || tr.sides.length !== 2) return;
    const sideTeams = tr.sides.map(s => byName(s.team) || (() => { const hs = s.got.filter(g => typeof g === 'string').map(holder).filter(Boolean); return hs.length ? hs[0].t : null; })());
    if (!sideTeams[0] || !sideTeams[1] || sideTeams[0] === sideTeams[1]) return;
    const items = [];
    let ok = true;
    tr.sides.forEach((s, i) => {
      const to = sideTeams[i], from = sideTeams[1 - i];
      s.got.forEach(g => {
        if (typeof g === 'string') { const id = espnId(g); if (id == null) ok = false; else items.push([+id, from.id, to.id]); }
        else if (g && g.pick) {
          const [y, r, origName] = g.pick;
          const orig = (origName && byName(origName)) || from;
          const pid = 'pk' + y + '-' + r + '-' + orig.id;
          items.push([pid, from.id, to.id]);
          out.pickOwners[pid] = to.id;
        }
      });
    });
    if (!ok) return;
    const ms = tr.date ? new Date(tr.date + 'T12:00:00').getTime() : 0;
    out.trades.push({ d: ms, items, league: true });
  });
  /* Picks in trades the user added by hand move too, oldest first. */
  (lg.manualTrades || []).slice().sort((a, b) => (a.d || 0) - (b.d || 0)).forEach(t => (t.items || []).forEach(([pid, , to]) => { if (typeof pid === 'string' && /^pk/.test(pid)) out.pickOwners[pid] = to; }));
  return out;
}

/* Value of a traded player today, whether or not he's still on a roster. */
function assetNow(m, pid) {
  if (typeof pid === 'string' && !/^\d+$/.test(pid)) {
    const k = m.picks.find(x => x.id === pid) || m.vs.byId.get(pid) || m.players.get(pid);
    return k || { id: pid, name: pid, pos: '?', value: 0, team: '' };
  }
  const p = m.players.get('e' + pid);
  if (p) return p;
  const x = m.vs.byEspn.get(String(pid));
  const nm = (m.lg.players || {})[pid];
  return x ? Object.assign({}, x, { id: 'e' + pid }) : { id: 'e' + pid, name: nm ? nm[0] : 'Player ' + pid, pos: nm ? POS[nm[1]] || '?' : '?', value: 0, team: '' };
}

function tradeGrades(m) {
  const covered = t => (m.bakedTrades || []).concat(m.lg.manualTrades || []).some(b => t.items.every(i => b.items.some(j => j.join(':') === i.join(':'))));
  const synced = (Array.isArray(m.lg.trades) ? m.lg.trades : []).filter(t => !covered(t));
  const manual = (Array.isArray(m.lg.manualTrades) ? m.lg.manualTrades : []).filter(x => !synced.some(s => tradeKey(s.items) === tradeKey(x.items)));
  const baked = (m.bakedTrades || []).filter(x => !synced.concat(manual).some(s => tradeKey(s.items) === tradeKey(x.items)));
  const trades = synced.concat(manual, baked);
  return trades.slice().sort((a, b) => (b.d || 0) - (a.d || 0)).map(x => {
    const sides = {};
    x.items.forEach(([pid, from, to]) => { (sides[to] = sides[to] || { got: [] }).got.push(assetNow(m, pid)); sides[from] = sides[from] || { got: [] }; });
    const ids = Object.keys(sides).map(Number);
    const rows = ids.map(id => ({ team: m.byId.get(id), got: sides[id].got, v: sides[id].got.reduce((s, p) => s + p.value, 0), adj: 0 }));
    if (rows.length === 2) { const st = sideTotals(rows[0].got.map(p => p.value), rows[1].got.map(p => p.value), m.lg.type === 'dynasty'); rows[0].adj = st.adjA; rows[1].adj = st.adjB; rows[0].v = st.ta; rows[1].v = st.tb; }
    rows.forEach(r => {
      const others = rows.filter(x => x !== r), ov = others.reduce((s, x) => s + x.v, 0) / Math.max(1, others.length);
      r.letter = letterGrade((r.v - ov) / Math.max(r.v, ov, 1));
    });
    rows.sort((a, b) => b.v - a.v);
    const top = rows[0], second = rows[1] || { v: 0 };
    const margin = top.v ? (top.v - second.v) / top.v : 0;
    const grade = margin < 0.07 ? 'Even' : margin < 0.2 ? 'Edge' : 'Win';
    return { d: x.d, rows, winner: margin < 0.07 ? null : top.team, margin, grade, manual: x.manual || null, pending: !!x.pending, league: !!x.league };
  });
}

/* Counteroffers: tweak an offer so it ends slightly in your favor (about +3%). */
function counterOffers(m, give, get, tMe, tThem) {
  const out = [];
  const target = 0.03;
  const score = (g, r) => { const f = fairness(g, r); return { f, s: Math.abs(f.pct - target) }; };
  const inTrade = new Set(give.concat(get).map(p => p.id));
  const mine = tMe ? tradeable(tMe.players.concat(tMe.picks || [])).filter(p => !inTrade.has(p.id)) : [];
  const theirs = tThem ? tradeable(tThem.players.concat(tThem.picks || [])).filter(p => !inTrade.has(p.id)) : [];
  give.forEach(p => { if (give.length > 1) { const g = give.filter(x => x !== p); out.push(Object.assign({ give: g, get, how: 'Take ' + p.name + ' out of your side' }, score(g, get))); } });
  theirs.slice(0, 25).forEach(p => { const r = get.concat(p); out.push(Object.assign({ give, get: r, how: 'Ask for ' + p.name + ' too' }, score(give, r))); });
  give.forEach(p => mine.filter(q => q.value < p.value).sort((a, b) => (b.pos === p.pos) - (a.pos === p.pos) || b.value - a.value).slice(0, 10).forEach(q => {
    const g = give.map(x => x === p ? q : x); out.push(Object.assign({ give: g, get, how: 'Send ' + q.name + ' instead of ' + p.name }, score(g, get)));
  }));
  get.forEach(p => theirs.filter(q => q.value > p.value && q.pos === p.pos).slice(0, 4).forEach(q => {
    const r = get.map(x => x === p ? q : x); out.push(Object.assign({ give, get: r, how: 'Ask for ' + q.name + ' instead of ' + p.name }, score(give, r)));
  }));
  const good = out.filter(x => x.f.pct >= -0.02 && x.f.pct <= 0.08).sort((a, b) => a.s - b.s);
  if (good.length) return good.slice(0, 4);
  /* Too far apart for one change: try two (swap one of yours down and ask for one of theirs). */
  const two = [];
  give.forEach(p => mine.filter(q => q.value < p.value).slice(0, 8).forEach(q => theirs.slice(0, 15).forEach(z => {
    const g = give.map(x => x === p ? q : x), r = get.concat(z);
    two.push(Object.assign({ give: g, get: r, how: 'Send ' + q.name + ' instead of ' + p.name + ', and ask for ' + z.name }, score(g, r)));
  })));
  return two.filter(x => x.f.pct >= -0.02 && x.f.pct <= 0.08).sort((a, b) => a.s - b.s).slice(0, 3);
}

/* Trade block: boost ideas that move players you've listed, or land players on your wishlist. */
function applyBlock(ideas, block) {
  if (!block || (!block.sell.length && !block.want.length)) return ideas;
  const sell = new Set(block.sell), want = new Set(block.want);
  ideas.forEach(x => {
    x.blockHits = x.give.filter(p => sell.has(p.id)).length + x.get.filter(p => want.has(p.id)).length;
    x.score += x.blockHits * 1500;
  });
  return ideas.sort((a, b) => b.score - a.score);
}

/* Roster value snapshots, one per sync, for the value-over-time chart. */
function snapshot(m) {
  const t = {};
  m.teams.forEach(x => { t[x.id] = [Math.round(x.starterValue), Math.round(x.totalValue)]; });
  return { d: Date.now(), w: m.lg.week || 0, t };
}

/* Bye week and injury planner for the rest of the season. */
function byePlanner(m, team) {
  const nfl = m.lg.nfl;
  if (!nfl || !nfl.teams) return null;
  const start = Math.max(1, m.lg.week || 1);
  const last = Math.max(...playoffWeeks(m.lg), (m.lg.sched && m.lg.sched.reg) || 14);
  const slots = m.lg.slots, need = {};
  SKILL.forEach(p => { need[p] = 0; });
  [[0, 'QB'], [2, 'RB'], [4, 'WR'], [6, 'TE']].forEach(([s, p]) => { need[p] = +slots[s] || 0; });
  const flex = (+slots[23] || 0) + (+slots[3] || 0) + (+slots[5] || 0);
  const weeks = [];
  for (let w = start; w <= last; w++) {
    const out = p => {
      const tm = nfl.teams[p.proTeam];
      if (tm && tm.bye === w) return 'bye';
      if (p.inj === 'INJURY_RESERVE' || p.slot === 21) return 'ir';
      if ((p.inj === 'OUT' || p.inj === 'DOUBTFUL' || p.inj === 'SUSPENSION') && w <= start + 1) return 'out';
      return '';
    };
    const avail = {}, missing = [];
    SKILL.forEach(p => { avail[p] = 0; });
    team.players.forEach(p => { if (!SKILL.includes(p.pos)) return; const why = out(p); if (why) { if (team.lineup.used.has(p.id)) missing.push({ p, why }); } else avail[p.pos]++; });
    const short = SKILL.filter(p => avail[p] < need[p]).map(p => ({ pos: p, have: avail[p], need: need[p] }));
    const extra = ['RB', 'WR', 'TE'].reduce((s, p) => s + Math.max(0, avail[p] - need[p]), 0);
    const flexShort = flex && extra < flex ? flex - extra : 0;
    weeks.push({ w, avail, short, flexShort, missing, playoff: playoffWeeks(m.lg).includes(w) });
  }
  return { weeks, need, flex };
}

/* Dynasty offseason plan: hold, sell, cut. */
const SELL_AGE = { QB: 34, RB: 27, WR: 30, TE: 31 };
function offseasonPlan(m, team) {
  const hold = [], sell = [], cut = [];
  const faBest = {};
  (m.freeAgents || []).forEach(p => { if (SKILL.includes(p.pos)) faBest[p.pos] = Math.max(faBest[p.pos] || 0, p.value); });
  const vals = team.players.filter(p => SKILL.includes(p.pos)).map(p => p.value).sort((a, b) => b - a);
  const core = vals[Math.min(5, vals.length - 1)] || 0;
  team.players.filter(p => SKILL.includes(p.pos)).forEach(p => {
    const old = p.age && SELL_AGE[p.pos] && p.age >= SELL_AGE[p.pos];
    const falling = p.trend < -Math.max(300, p.value * 0.1);
    if ((old && p.value >= 1500) || (falling && p.value >= 2500 && p.age && p.age >= SELL_AGE[p.pos] - 2)) sell.push({ p, why: old ? 'Age ' + p.age.toFixed(1) + ': ' + p.pos + 's usually lose value fast from here' : 'Value down ' + Math.abs(Math.round(p.trend)).toLocaleString('en-US') + ' in 30 days' });
    else if (p.value >= core && (!p.age || p.age < SELL_AGE[p.pos] - 1)) hold.push({ p, why: p.age ? 'Core piece, age ' + p.age.toFixed(1) : 'Core piece' });
    else if (p.value < Math.max(250, (faBest[p.pos] || 0) * 0.9) && !team.lineup.used.has(p.id)) cut.push({ p, why: faBest[p.pos] ? 'A free agent at ' + p.pos + ' is worth about as much' : 'Lowest value on your bench' });
  });
  const by = (a, b) => b.p.value - a.p.value;
  return { hold: hold.sort(by), sell: sell.sort(by), cut: cut.sort((a, b) => a.p.value - b.p.value).slice(0, 6) };
}

/* Rookie mock draft: linear order, teams take the best player on the board, nudged toward needs. */
function mockDraft(m, consensus, mine, opts) {
  opts = opts || {};
  const n = m.teams.length;
  const year = m.picks.length ? m.picks[0].year : null;
  if (!year) return null;
  const picks = m.picks.filter(p => p.year === year).sort((a, b) => a.round - b.round || a.pickNo - b.pickNo);
  const rankC = new Map(consensus.map((r, i) => [r[0], i])), rankM = new Map((mine || consensus).map((r, i) => [r[0], i]));
  const left = consensus.slice();
  let s = opts.seed || 1;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out = [];
  const one = m.lg.qbs !== 2;
  picks.forEach(pk => {
    const t = m.byId.get(pk.owner);
    const isMe = pk.owner === m.lg.myTeamId;
    let best = null, bestScore = -1;
    left.forEach(r => {
      const rk = isMe ? rankM.get(r[0]) : rankC.get(r[0]);
      let v = 1000 * Math.exp(-rk / 16);
      if (!isMe) {
        if (t && t.needs.includes(r[1])) v += 45;
        if (one && r[1] === 'QB' && !(t && t.needs.includes('QB'))) v *= 0.85;
        if (opts.random) v *= 0.92 + rnd() * 0.16;
      }
      if (v > bestScore) { bestScore = v; best = r; }
    });
    if (!best) return;
    left.splice(left.indexOf(best), 1);
    out.push({ pick: pk, team: t, r: best, mine: isMe, reach: (isMe ? rankM : rankC).get(best[0]) - out.length });
  });
  return { year, out };
}

/* Rival tracker: what changed on a team since the previous sync. */
function rivalChanges(m, prev) {
  if (!prev || !prev.rosters) return null;
  return m.teams.map(t => {
    const before = new Set(prev.rosters[t.id] || []);
    const now = new Set(t.players.map(p => p.espn));
    const added = t.players.filter(p => !before.has(p.espn));
    const dropped = [...before].filter(id => !now.has(id)).map(id => assetNow(m, id));
    const pv = prev.values && prev.values[t.id];
    return { t, added, dropped, dTotal: pv != null ? t.totalValue - pv : null, recBefore: prev.rec && prev.rec[t.id] };
  });
}
function rosterSnapshot(lg, m) {
  const rosters = {}, values = {}, rec = {};
  lg.teams.forEach(t => { rosters[t.id] = t.roster.map(r => String(r[0])); rec[t.id] = [t.w, t.l]; });
  if (m) m.teams.forEach(t => { values[t.id] = Math.round(t.totalValue); });
  return { at: lg.syncedAt || Date.now(), rosters, values, rec };
}

/* League records from the schedule. */
function leagueRecords(m) {
  const sch = Array.isArray(m.lg.sch) ? m.lg.sch.filter(g => g[5]) : [];
  if (!sch.length) return null;
  const games = [];
  sch.forEach(g => { games.push({ w: g[0], t: g[1], o: g[2], pts: g[3], opp: g[4], won: g[5] === 1 }); games.push({ w: g[0], t: g[2], o: g[1], pts: g[4], opp: g[3], won: g[5] === 2 }); });
  const T = id => m.byId.get(id);
  const max = (arr, f) => arr.reduce((b, x) => (f(x) > f(b) ? x : b), arr[0]);
  const high = max(games, g => g.pts), low = max(games, g => -g.pts);
  const blow = max(sch, g => Math.abs(g[3] - g[4])), close = max(sch, g => -Math.abs(g[3] - g[4]));
  const badLoss = max(games.filter(g => !g.won), g => g.pts), luckyWin = max(games.filter(g => g.won), g => -g.pts);
  const streak = {};
  m.teams.forEach(t => {
    const gs = games.filter(g => g.t === t.id).sort((a, b) => a.w - b.w);
    let best = 0, cur = 0, curL = 0, worst = 0;
    gs.forEach(g => { if (g.won) { cur++; curL = 0; } else { curL++; cur = 0; } best = Math.max(best, cur); worst = Math.max(worst, curL); });
    streak[t.id] = { best, worst, now: cur ? 'W' + cur : 'L' + curL };
  });
  const longW = max(m.teams, t => streak[t.id].best), longL = max(m.teams, t => streak[t.id].worst);
  const weekly = {};
  games.forEach(g => { (weekly[g.w] = weekly[g.w] || []).push(g); });
  const topWeeks = {};
  Object.values(weekly).forEach(ws => { const b = max(ws, g => g.pts); topWeeks[b.t] = (topWeeks[b.t] || 0) + 1; });
  const mostTop = Object.entries(topWeeks).sort((a, b) => b[1] - a[1])[0];
  return [
    { k: 'Highest score', v: high.pts.toFixed(1), who: T(high.t), note: 'Week ' + high.w },
    { k: 'Lowest score', v: low.pts.toFixed(1), who: T(low.t), note: 'Week ' + low.w },
    { k: 'Biggest blowout', v: Math.abs(blow[3] - blow[4]).toFixed(1), who: T(blow[3] > blow[4] ? blow[1] : blow[2]), note: 'over ' + (T(blow[3] > blow[4] ? blow[2] : blow[1]) || {}).name + ', week ' + blow[0] },
    { k: 'Closest game', v: Math.abs(close[3] - close[4]).toFixed(1), who: T(close[3] > close[4] ? close[1] : close[2]), note: 'beat ' + (T(close[3] > close[4] ? close[2] : close[1]) || {}).name + ', week ' + close[0] },
    badLoss ? { k: 'Unluckiest loss', v: badLoss.pts.toFixed(1), who: T(badLoss.t), note: 'lost anyway, week ' + badLoss.w } : null,
    luckyWin ? { k: 'Luckiest win', v: luckyWin.pts.toFixed(1), who: T(luckyWin.t), note: 'won anyway, week ' + luckyWin.w } : null,
    { k: 'Longest win streak', v: streak[longW.id].best + ' W', who: longW, note: 'now ' + streak[longW.id].now },
    { k: 'Longest losing streak', v: streak[longL.id].worst + ' L', who: longL, note: 'now ' + streak[longL.id].now },
    mostTop ? { k: 'Most weekly high scores', v: mostTop[1] + '×', who: T(+mostTop[0]), note: 'top score of the week' } : null
  ].filter(Boolean);
}

if (typeof module !== 'undefined' && module.exports) Object.assign(module.exports, { tradeGrades, counterOffers, applyBlock, snapshot, byePlanner, offseasonPlan, mockDraft, rivalChanges, rosterSnapshot, leagueRecords });
