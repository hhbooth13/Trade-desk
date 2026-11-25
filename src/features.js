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
    const proc = tr.processes ? new Date(tr.processes).getTime() : 0;
    out.trades.push({ d: ms, items, league: true, pending: proc > Date.now() || undefined, processes: proc || undefined });
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
    return { d: x.d, rows, winner: margin < 0.07 ? null : top.team, margin, grade, manual: x.manual || null, pending: !!x.pending && !(x.processes && x.processes < Date.now()), processes: x.processes || null, league: !!x.league };
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

/* ---------- Dynasty outlook: how strong each team looks now, next year, and three years out ----------
   Now: this season's lineup using redraft values (injuries and news included).
   Later: each player's dynasty value moved along his position's age curve, plus the draft picks a team
   owns turning into rookies (a pick counts for 55% in its first season, 85% in the next, then 100%). */
function outlookLater(p, k) { if (!p.age || !PEAK_AGE[p.pos]) return p.value * Math.pow(0.9, k); return p.value * ageFactor(p.pos, p.age + k) / ageFactor(p.pos, p.age); }
function dynastyOutlook(m) {
  if (m.lg.type !== 'dynasty') return null;
  const season = +m.lg.season || new Date().getFullYear();
  const WIN = [{ k: 0, label: 'Now', year: season }, { k: 1, label: String(season + 1), year: season + 1 }, { k: 3, label: String(season + 3), year: season + 3 }];
  const today = new Date().toISOString().slice(0, 10);
  const newsR = new Map(); ((typeof NEWS !== 'undefined' && NEWS && NEWS.items) || []).filter(x => !x.until || x.until >= today).forEach(x => { if (x.espn) newsR.set(String(x.espn), x.redraft); });
  const nowVal = p => {
    const a = m.vs.alt && ((p.espn && m.vs.alt.byEspn.get(p.espn)) || m.vs.alt.byKey.get(nk(p.name) + '|' + p.pos));
    let v = a ? a.value : p.value * 0.8;
    if (p.inj && INJ_FACTOR[p.inj]) v *= INJ_FACTOR[p.inj];
    const nr = newsR.get(String(p.espn)); if (typeof nr === 'number') v *= nr;
    return v;
  };
  const later = outlookLater;
  const rows = m.teams.map(t => {
    const sk = t.players.filter(p => SKILL.includes(p.pos) || p.pos === 'K' || p.pos === 'D/ST');
    const scores = WIN.map(w => {
      const proj = sk.map(p => Object.assign({}, p, { pv: w.k === 0 ? nowVal(p) : later(p, w.k) }));
      let s = lineup(proj, m.lg.slots, 'pv').value;
      if (w.k > 0) (t.picks || []).forEach(pk => { const yrs = season + w.k - pk.year; if (yrs >= 0) s += 0.5 * pk.value * [0.55, 0.85, 1][Math.min(2, yrs)]; });
      return s;
    });
    const st = lineup(t.players, m.lg.slots).starters.map(x => x.p).filter(p => p && p.age);
    const age = st.length ? st.reduce((a, p) => a + p.age, 0) / st.length : null;
    const sellers = t.players.filter(p => !outNow(p) && SKILL.includes(p.pos) && p.age && PEAK_AGE[p.pos] && p.age >= PEAK_AGE[p.pos] + (p.pos === 'RB' ? 1 : 2) && p.value >= 1500).sort((a, b) => b.value - a.value).slice(0, 3);
    const young = t.players.filter(p => SKILL.includes(p.pos) && p.age && p.age <= 24 && p.value >= 1500).sort((a, b) => b.value - a.value).slice(0, 3);
    return { team: t, scores, age, picks: (t.picks || []).filter(p => p.round === 1).length, sellers, young };
  });
  const n = rows.length;
  WIN.forEach((w, i) => { rows.slice().sort((a, b) => b.scores[i] - a.scores[i]).forEach((r, j) => { (r.ranks = r.ranks || [])[i] = j + 1; }); });
  const third = Math.ceil(n / 3), half = Math.ceil(n / 2);
  rows.forEach(r => {
    const [now, next, far] = r.ranks;
    const d = now - far;
    r.label = now <= third && far <= half ? 'Dynasty power' : now <= third ? 'Win now' : now > n - third && far <= half ? 'Rebuilding'
      : (far <= third && far < now) || (d >= 3 && far <= half) ? 'Rising' : d <= -3 && far > half ? 'Fading' : now > n - third && far > n - third ? 'Stuck' : 'Middle';
    r.trend = now - far;
  });
  rows.sort((a, b) => a.ranks[0] - b.ranks[0]);
  return { windows: WIN, rows };
}

/* ---------- Game plan: the recommended path for a team, from its outlook ---------- */
function gamePlan(m, o, teamId) {
  const r = o.rows.find(x => x.team.id === teamId);
  if (!r) return null;
  const n = o.rows.length, third = Math.ceil(n / 3), half = Math.ceil(n / 2);
  const t = r.team, [now, next, far] = r.ranks;
  /* direction: push now when this season is the team's best shot and it's near the top; otherwise build for later */
  const dir = r.label === 'Dynasty power' ? 'balanced' : (r.label === 'Win now' || (r.label === 'Fading' && now <= half) || (r.label === 'Middle' && now < far && now <= half)) ? 'contend'
    : (r.label === 'Rebuilding' || r.label === 'Stuck' || r.label === 'Rising' || r.label === 'Fading' || far < now) ? 'rebuild' : 'contend';
  const HEAD = {
    balanced: ['Stay the course', 'You\u2019re strong now and later. Don\u2019t sell the future for a small upgrade; turn extra depth into one better starter.'],
    contend: ['Go for it this season', now <= third ? 'You\u2019re a top team now. Use picks and young depth to upgrade your weakest starters while your window is open.' : 'You\u2019re close. One or two upgrades at your weak spots could make you a real contender; pay with picks and young bench players.'],
    rebuild: ['Build for ' + o.windows[2].year, far <= half ? 'Your best years are ahead. Sell veterans who will lose value, and add picks and players 24 and under.' : 'You\u2019re not winning now or later with this roster. Sell anyone past his prime while he still has value and stock up on picks and young players.']
  };
  const others = o.rows.filter(x => x.team.id !== t.id);
  const isBuyer = x => ['Win now', 'Fading', 'Dynasty power', 'Middle'].includes(x.label) && x.ranks[0] <= half + 1;
  const isSeller = x => ['Rebuilding', 'Stuck', 'Rising'].includes(x.label) || x.ranks[2] < x.ranks[0] - 2;
  const loss = p => p.value ? 1 - outlookLater(p, 3) / p.value : 0;
  const skill = t.players.filter(p => SKILL.includes(p.pos) && p.value >= 300);
  /* sell: players whose value drops most by year 3 (rebuild), or surplus/aging bench pieces (contend) */
  const startersIds = new Set(lineup(t.players, m.lg.slots).starters.map(x => x.p && x.p.id).filter(Boolean));
  let sell = dir === 'rebuild' ? skill.filter(p => loss(p) >= 0.2 && (!p.age || p.age > 24)).sort((a, b) => b.value * loss(b) - a.value * loss(a)).slice(0, 5)
    : skill.filter(p => !startersIds.has(p.id) && (t.surplus.includes(p.pos) || (p.age && p.age <= 24 && dir === 'contend'))).sort((a, b) => b.value - a.value).slice(0, 4);
  const buyersFor = p => others.filter(x => (dir === 'rebuild' ? isBuyer(x) : true) && x.team.needs.includes(p.pos)).slice(0, 3).map(x => x.team);
  /* buy: proven starters at your needs from sellers (contend), or young players / picks from buyers (rebuild) */
  let buy = [];
  if (dir === 'rebuild') {
    others.filter(isBuyer).forEach(x => x.team.players.filter(p => SKILL.includes(p.pos) && p.age && p.age <= 24 && p.value >= 1200).forEach(p => buy.push({ p, from: x.team })));
    buy.sort((a, b) => b.p.value - a.p.value); buy = buy.slice(0, 5);
  } else {
    const needs = t.needs.length ? t.needs : SKILL.filter(p => t.rank[p] > third);
    others.filter(isSeller).forEach(x => x.team.players.filter(p => needs.includes(p.pos) && p.value >= 1500 && (!p.age || p.age >= 25) && !outNow(p)).forEach(p => buy.push({ p, from: x.team })));
    buy.sort((a, b) => b.p.value - a.p.value); buy = buy.slice(0, 5);
  }
  const picks = (t.picks || []).slice().sort((a, b) => a.year - b.year || a.round - b.round);
  const pickAdvice = dir === 'rebuild' ? 'Keep your picks' + (picks.length ? ' (' + picks.filter(p => p.round === 1).length + ' firsts)' : '') + ' and ask for more in every veteran trade.'
    : dir === 'contend' ? (picks.length ? 'Your picks are trade chips. Later-year picks cost you the least today.' : 'You\u2019re out of picks to deal; use young bench players instead.')
    : 'Hold your firsts unless they bring back a clear upgrade.';
  const steps = [];
  const hold = t.players.filter(p => SKILL.includes(p.pos) && outNow(p) && p.value >= 800).sort((a, b) => b.value - a.value);
  sell = sell.filter(p => !outNow(p));
  const healthy = sell, hurt = [];
  if (healthy.length) steps.push(dir === 'rebuild' ? 'Sell ' + healthy.slice(0, 2).map(p => p.name).join(' and ') + ' before age drops their value.' : 'Package ' + healthy.slice(0, 2).map(p => p.name).join(' and ') + ' (bench depth) for one better starter.');
  if (hurt.length && dir === 'rebuild') steps.push('Hold ' + hurt.map(p => p.name).join(' and ') + ' until ' + (hurt.length > 1 ? 'they\u2019re' : 'he\u2019s') + ' healthy; win-now teams won\u2019t pay for an injured player.');
  if (buy.length) steps.push(dir === 'rebuild' ? 'Target young players like ' + buy[0].p.name + ' from ' + (buy[0].from.abbrev || buy[0].from.name) + ', a team trying to win now.' : 'Target ' + buy[0].p.name + ' from ' + (buy[0].from.abbrev || buy[0].from.name) + ', a team looking to the future.');
  if (t.needs.length && dir !== 'rebuild') steps.push('Your weakest spot' + (t.needs.length > 1 ? 's are ' : ' is ') + t.needs.join(' and ') + '. Upgrade there first.');
  steps.push(pickAdvice);
  const rebuilders = others.filter(x => !isBuyer(x) && ['Rebuilding', 'Rising', 'Stuck', 'Middle'].includes(x.label)).map(x => x.team);
  const holdInfo = hold.map(p => ({ p, buyers: rebuilders.filter(b => b.needs.includes(p.pos)).concat(rebuilders.filter(b => !b.needs.includes(p.pos))).slice(0, 3) }));
  if (hold.length) steps.push(hold.slice(0, 2).map(p => p.name).join(' and ') + ': hold, or sell to a rebuilding team' + (holdInfo[0].buyers.length ? ' (' + holdInfo[0].buyers.map(b => b.abbrev || b.name).join(', ') + ')' : '') + '. Contenders won\u2019t pay for an injured player, but ' + (hold.length > 1 ? 'their' : 'his') + ' value climbs as ' + (hold.length > 1 ? 'they heal' : 'he heals') + '.');
  return { r, dir, hold: holdInfo, head: HEAD[dir][0], why: HEAD[dir][1], steps, sell: sell.map(p => ({ p, loss: loss(p), buyers: buyersFor(p), out: outNow(p) })), buy, picks };
}
