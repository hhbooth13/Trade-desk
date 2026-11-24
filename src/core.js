/* ---------- Core logic: values, lineups, team analysis, trades (no DOM) ---------- */
const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' };
const PRO = { 0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU' };
const SLOT_NAME = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 16: 'D/ST', 17: 'K', 3: 'RB/WR', 5: 'WR/TE', 23: 'FLEX', 7: 'SFLEX', 20: 'Bench', 21: 'IR' };
const SLOT_ELIG = { 0: ['QB'], 2: ['RB'], 4: ['WR'], 6: ['TE'], 16: ['D/ST'], 17: ['K'], 3: ['RB', 'WR'], 5: ['WR', 'TE'], 23: ['RB', 'WR', 'TE'], 7: ['QB', 'RB', 'WR', 'TE'] };
const SLOT_ORDER = [0, 2, 4, 6, 16, 17, 3, 5, 23, 7];
const SKILL = ['QB', 'RB', 'WR', 'TE'];
const TRADE_EXP = 1.15;

const nk = s => String(s || '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z0-9]/g, '');

function parseValues(txt) {
  return String(txt || '').trim().split('\n').filter(Boolean).map(l => {
    const [name, pos, team, espn, value, age, trend] = l.split('|');
    const key = nk(name);
    return {
      id: pos === 'PICK' ? 'k' + key : (espn ? 'e' + espn : 'n' + key + pos),
      name, pos, team: team || '', espn: espn || '', value: +value || 0,
      age: age ? +age : null, trend: +trend || 0, key, fa: true
    };
  });
}

function indexValues(list) {
  const byEspn = new Map(), byKey = new Map(), byId = new Map();
  list.forEach(x => {
    if (x.espn) byEspn.set(x.espn, x);
    byKey.set(x.key + '|' + x.pos, x);
    byId.set(x.id, x);
  });
  return { list, byEspn, byKey, byId };
}

function mkPlayer(r, vs, teamId) {
  const [pid, name, posId, pro, slot, inj, owned, proj, avg] = r;
  const pos = POS[posId] || '?';
  const find = ix => ix ? (ix.byEspn.get(String(pid)) || ix.byKey.get(nk(name) + '|' + pos)) : null;
  const fc = find(vs), alt = fc ? null : find(vs.alt);
  return {
    id: 'e' + pid, espn: String(pid), name, pos,
    team: (fc && fc.team) || (alt && alt.team) || PRO[pro] || 'FA', slot, inj: inj && inj !== 'ACTIVE' ? inj : '',
    value: fc ? fc.value : 0, fcValue: fc ? fc.value : 0, age: (fc || alt || {}).age || null, trend: fc ? fc.trend : 0, owner: teamId,
    altValue: alt ? alt.value : 0, owned: owned != null ? +owned : null, est: fc ? '' : null,
    proTeam: pro, proj: proj != null ? +proj : null, avg: avg != null ? +avg : null
  };
}

/* ---------- Estimated values for players FantasyCalc doesn't value ----------
   1. Value in the other format (dynasty <-> redraft): converted with the ratio seen for the
      10 most similar players (value and age) at the same position, then discounted for injuries in redraft.
   2. No FantasyCalc value at all: matched to valued players with similar ESPN roster % at the position,
      or a small positional floor. Kickers and defenses get a small value from roster % (or a flat floor). */
const SEASON_ENDING = {};
const INJ_FACTOR = { INJURY_RESERVE: 0.3, OUT: 0.6, DOUBTFUL: 0.8, QUESTIONABLE: 0.95, SUSPENSION: 0.5 };
/* Dynasty: injuries matter less (there is next season), age matters more. */
const DYN_INJ_FACTOR = { INJURY_RESERVE: 0.85, OUT: 0.95, SUSPENSION: 0.9 };
const PEAK_AGE = { QB: 31, RB: 25, WR: 27, TE: 28 };
function ageFactor(pos, age) {
  const peak = PEAK_AGE[pos];
  if (!peak || !age) return 1;
  const fall = pos === 'RB' ? 0.12 : pos === 'QB' ? 0.06 : 0.09;
  return age <= peak ? Math.min(1.15, 1 + 0.03 * (peak - age)) : Math.max(0.35, 1 - fall * (age - peak));
}
function estimateValues(players, vs, type, allPlayers) {
  const pairs = {};
  if (vs.alt) vs.list.forEach(x => {
    const a = (x.espn && vs.alt.byEspn.get(x.espn)) || vs.alt.byKey.get(x.key + '|' + x.pos);
    if (a && a.value > 0 && x.value > 0) (pairs[x.pos] = pairs[x.pos] || []).push({ a: a.value, m: x.value, age: x.age || a.age });
  });
  const posVals = {};
  vs.list.forEach(x => (posVals[x.pos] = posVals[x.pos] || []).push(x.value));
  for (const k in posVals) posVals[k].sort((a, b) => a - b);
  const pct = (arr, q) => arr && arr.length ? arr[Math.floor((arr.length - 1) * q)] : 0;
  const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  players.forEach(p => {
    if (p.est !== null) return;
    if (type === 'dynasty' && SEASON_ENDING[p.name] && p.altValue > 0 && !(pairs[p.pos] && pairs[p.pos].length >= 5)) { /* fall through to conversion */ }
    if (type === 'redraft' && SEASON_ENDING[p.name]) {
      p.value = Math.max(10, Math.round((p.altValue || 300) * 0.01)); p.est = 'season'; p.estWhy = SEASON_ENDING[p.name] + ', so almost no value for the rest of this season.'; return;
    }
    if (p.altValue > 0 && pairs[p.pos] && pairs[p.pos].length >= 5) {
      const near = pairs[p.pos].map(q => ({ q, d: Math.abs(Math.log(q.a) - Math.log(p.altValue)) + (p.age && q.age ? 0.12 * Math.abs(p.age - q.age) : 0) }))
        .sort((x, y) => x.d - y.d).slice(0, 10).map(x => x.q.m / x.q.a);
      let v = p.altValue * median(near);
      let why = 'Converted from his ' + (type === 'redraft' ? 'dynasty' : 'redraft') + ' value (' + Math.round(p.altValue).toLocaleString('en-US') + ') using similar ' + p.pos + 's.';
      if (p.age) why += ' Compared with players near his age (' + p.age.toFixed(1) + ').';
      const f = (type === 'redraft' ? INJ_FACTOR : DYN_INJ_FACTOR)[p.inj];
      if (f) { v *= f; why += ' Discounted ' + Math.round((1 - f) * 100) + '% because ESPN lists him as ' + p.inj.replace('_', ' ').toLowerCase() + '.'; }
      p.value = Math.max(10, Math.round(Math.min(v, pct(posVals[p.pos], 1) || v))); p.est = 'convert'; p.estWhy = why; return;
    }
    if (p.pos === 'K' || p.pos === 'D/ST') {
      p.value = p.owned != null ? Math.round(30 + 1.5 * p.owned) : 40; p.est = 'floor';
      p.estWhy = 'FantasyCalc doesn\'t value kickers or defenses; small value' + (p.owned != null ? ' based on ESPN roster % (' + Math.round(p.owned) + '%).' : '.'); return;
    }
    const floor = Math.max(10, Math.round(pct(posVals[p.pos], 0.1) || 25));
    if (p.owned != null) {
      const peers = allPlayers.filter(q => q.pos === p.pos && q.est === '' && q.owned != null && q.value > 0 && Math.abs(q.owned - p.owned) <= 15)
        .sort((a, b) => Math.abs(a.owned - p.owned) - Math.abs(b.owned - p.owned)).slice(0, 8).map(q => q.value);
      if (peers.length >= 3) {
        let v = Math.min(median(peers) * 0.7, pct(posVals[p.pos], 0.25));
        v *= (type === 'redraft' ? INJ_FACTOR : DYN_INJ_FACTOR)[p.inj] || 1;
        if (type === 'dynasty') v *= ageFactor(p.pos, p.age);
        p.value = Math.round(Math.max(floor, v)); p.est = 'owned';
        p.estWhy = 'Not in FantasyCalc. Estimated from valued ' + p.pos + 's with a similar ESPN roster % (' + Math.round(p.owned) + '%).'; return;
      }
    }
    p.value = floor; p.est = 'floor'; p.estWhy = 'Not in FantasyCalc, so he gets a depth-player value for a ' + p.pos + '.';
  });
}
/* Real-world news adjustments (injuries, role changes, trades), kept in news.json and refreshed daily. */
function applyNews(players, news, type, today) {
  if (!news || !Array.isArray(news.items)) return;
  today = today || new Date().toISOString().slice(0, 10);
  const live = news.items.filter(x => !x.until || x.until >= today);
  const byEspn = new Map(), byName = new Map();
  live.forEach(x => { if (x.espn) byEspn.set(String(x.espn), x); byName.set(nk(x.name), x); });
  players.forEach(p => {
    const x = (p.espn && byEspn.get(String(p.espn))) || byName.get(nk(p.name));
    if (!x) return;
    const f = typeof x.factor === 'number' ? x.factor : x[type];
    p.news = { note: x.note, date: x.date, factor: f == null ? 1 : f };
    if (f != null && f !== 1 && p.value > 0) { p.value = Math.max(f < 0.05 ? 10 : 1, Math.round(p.value * f)); p.newsAdj = true; }
  });
}
function applyOverrides(players, overrides) {
  if (!overrides) return;
  players.forEach(p => { if (overrides[p.id] != null) { p.value = +overrides[p.id]; p.est = 'manual'; p.estWhy = 'Value you set by hand.'; } });
}

function lineup(players, slots, key) {
  key = key || 'value';
  const avail = players.filter(p => p.slot !== 21).slice().sort((a, b) => (b[key] || 0) - (a[key] || 0));
  const used = new Set(), starters = [];
  let value = 0;
  for (const s of SLOT_ORDER) {
    const n = +(slots && slots[s]) || 0;
    for (let i = 0; i < n; i++) {
      const p = avail.find(q => !used.has(q.id) && SLOT_ELIG[s].includes(q.pos));
      if (p) { used.add(p.id); value += p[key] || 0; }
      starters.push({ slot: s, p: p || null });
    }
  }
  return { starters, used, value };
}

function analyzeTeam(t, slots) {
  const lu = lineup(t.players, slots);
  t.lineup = lu;
  t.starterValue = lu.value;
  t.totalValue = t.players.reduce((a, p) => a + p.value, 0);
  t.pos = {}; t.depth = {};
  SKILL.forEach(p => { t.pos[p] = 0; t.depth[p] = 0; });
  lu.starters.forEach(s => { if (s.p && t.pos[s.p.pos] !== undefined) t.pos[s.p.pos] += s.p.value; });
  t.players.forEach(p => { if (!lu.used.has(p.id) && t.depth[p.pos] !== undefined) t.depth[p.pos] += p.value; });
}

function rankTeams(teams) {
  const rankBy = (get) => {
    const sorted = teams.slice().sort((a, b) => get(b) - get(a));
    const r = new Map();
    sorted.forEach((t, i) => r.set(t.id, i + 1));
    return r;
  };
  const metrics = { starter: t => t.starterValue, total: t => t.totalValue };
  SKILL.forEach(p => { metrics[p] = t => t.pos[p]; metrics['d' + p] = t => t.depth[p]; });
  const ranks = {};
  for (const k in metrics) ranks[k] = rankBy(metrics[k]);
  const n = teams.length;
  teams.forEach(t => {
    t.rank = {};
    for (const k in ranks) t.rank[k] = ranks[k].get(t.id);
    t.needs = SKILL.filter(p => t.rank[p] > Math.ceil(n * 0.6));
    t.surplus = SKILL.filter(p => !t.needs.includes(p) && (t.rank[p] <= Math.ceil(n * 0.35) || t.rank['d' + p] <= Math.ceil(n * 0.25)));
  });
}

function buildModel(lg, vs) {
  WAIVER_DYNASTY = lg.type === 'dynasty';
  const teams = lg.teams.map(t => Object.assign({}, t, { players: t.roster.map(r => mkPlayer(r, vs, t.id)), picks: [] }));
  const everyone = [].concat(...teams.map(t => t.players));
  estimateValues(everyone, vs, lg.type === 'dynasty' ? 'dynasty' : 'redraft', everyone);
  applyNews(everyone, typeof NEWS !== 'undefined' ? NEWS : null, lg.type === 'dynasty' ? 'dynasty' : 'redraft');
  applyOverrides(everyone, lg.valueOverrides);
  const baked = typeof resolveLeagueTrades === 'function' ? resolveLeagueTrades(lg, teams) : { trades: [], pickOwners: {} };
  const picks = lg.type === 'dynasty' ? draftPicks(Object.assign({}, lg, { pickOwners: Object.assign({}, baked.pickOwners, lg.pickOwners || {}) }), vs, teams) : [];
  const byId = new Map(teams.map(t => [t.id, t]));
  picks.forEach(p => { const t = byId.get(p.owner); if (t) t.picks.push(p); });
  teams.forEach(t => { analyzeTeam(t, lg.slots); t.pickValue = t.picks.reduce((a, p) => a + p.value, 0); t.totalValue += t.pickValue; });
  rankTeams(teams);
  const players = new Map();
  teams.forEach(t => t.players.concat(t.picks).forEach(p => players.set(p.id, p)));
  /* Free agents: ESPN's list when the sync provided it, otherwise FantasyCalc players on no roster. */
  let freeAgents, faSource;
  if (Array.isArray(lg.fa) && lg.fa.length) {
    freeAgents = lg.fa.map(r => Object.assign(mkPlayer([r[0], r[1], r[2], r[3], 20, r[5], r[6]], vs, null), { waivers: !!r[4] }));
    estimateValues(freeAgents, vs, lg.type === 'dynasty' ? 'dynasty' : 'redraft', everyone.concat(freeAgents));
    applyNews(freeAgents, typeof NEWS !== 'undefined' ? NEWS : null, lg.type === 'dynasty' ? 'dynasty' : 'redraft');
    faSource = 'espn';
  } else {
    const rostered = new Set(everyone.map(p => p.espn));
    const keys = new Set(everyone.map(p => nk(p.name) + '|' + p.pos));
    freeAgents = vs.list.filter(x => SKILL.includes(x.pos) && !(x.espn && rostered.has(x.espn)) && !keys.has(x.key + '|' + x.pos))
      .map(x => ({ id: x.id, espn: x.espn, name: x.name, pos: x.pos, team: x.team, slot: 20, inj: '', value: x.value, fcValue: x.value, age: x.age, trend: x.trend, owner: null, est: '' }));
    faSource = 'fc';
  }
  return { lg, vs, teams, byId, players, picks, freeAgents, faSource, bakedTrades: baked.trades };
}

/* ---------- Dynasty draft picks ----------
   Linear (non-snake) order: worst record picks first in every round.
   Next year's picks are valued by projected slot (between FantasyCalc's Early/Mid/Late values);
   later years use FantasyCalc's generic value for that round. */
const ROUND_NAME = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
function draftOrder(teams) {
  const pct = t => { const g = (t.w || 0) + (t.l || 0) + (t.t || 0); return g ? ((t.w || 0) + 0.5 * (t.t || 0)) / g : 0.5; };
  return teams.slice().sort((a, b) => pct(a) - pct(b) || (a.pf || 0) - (b.pf || 0) || a.id - b.id);
}
function pickValue(vs, year, round, slot, n, projected) {
  const get = s => { const x = vs.byKey.get(nk(year + ' ' + ROUND_NAME[round] + s) + '|PICK'); return x ? x.value : null; };
  const generic = get('');
  if (!projected) return generic;
  const E = get(' (Early)'), M = get(' (Mid)'), L = get(' (Late)');
  if (E == null || M == null || L == null) return generic;
  const t = n > 1 ? (slot - 1) / (n - 1) : 0.5;
  let v;
  if (t <= 0.5) v = E + (M - E) * (t - 1 / 6) / (0.5 - 1 / 6);
  else v = M + (L - M) * (t - 0.5) / (5 / 6 - 0.5);
  return Math.round(Math.min(E * 1.2, Math.max(L * 0.8, v)));
}
function draftPicks(lg, vs, teams) {
  const rounds = Math.min(4, Math.max(1, +lg.pickRounds || 3));
  const next = (+lg.season || new Date().getFullYear()) + 1;
  const order = draftOrder(teams), n = order.length;
  const owners = lg.pickOwners || {};
  const out = [];
  for (let y = next; y < next + 3; y++) {
    for (let r = 1; r <= rounds; r++) {
      order.forEach((t, i) => {
        const slot = i + 1, projected = y === next;
        const value = pickValue(vs, y, r, slot, n, projected);
        if (value == null) return;
        const id = 'pk' + y + '-' + r + '-' + t.id;
        const owner = owners[id] != null && teams.some(x => x.id === owners[id]) ? owners[id] : t.id;
        const label = projected ? y + ' ' + r + '.' + String(slot).padStart(2, '0') : y + ' ' + ROUND_NAME[r];
        out.push({
          id, pos: 'PICK', name: label, alias: y + ' ' + ROUND_NAME[r] + ' round ' + (t.abbrev || '') + ' ' + (t.name || ''), year: y, round: r, pickNo: projected ? slot : null, orig: t.id, owner, value,
          team: (owner !== t.id ? 'via ' + (t.abbrev || t.name) + ' · ' : '') + (projected ? 'projected from standings' : 'round ' + r),
          age: null, trend: 0, slot: 20
        });
      });
    }
  }
  return out;
}

/* Trade value: packages are worth less than the sum of their parts, so one stud beats two good players. */
function tv(vals) {
  const s = vals.reduce((a, v) => a + Math.pow(Math.max(+v || 0, 0), TRADE_EXP), 0);
  return Math.round(Math.pow(s, 1 / TRADE_EXP));
}

/* FantasyCalc's waiver adjustment. When one side gets fewer players, the other side has to cut someone
   to make room, so the side getting fewer players is credited with roster-spot value, based on the
   cheapest extra players on the bigger side:
   Dynasty: min(value x 0.6982, 753 + i x 0.23) per extra player, floored.
   Redraft: min(round(value x 0.42), 550) per extra player, plus 200 for each extra player beyond the first. */
let WAIVER_DYNASTY = true;
const WAIVER = { dynasty: { pct: 0.6982, cap: 753, step: 0.23 }, redraft: { pct: 0.42, cap: 550, extra: 200 } };
function waiverAdj(shortVals, longVals, dyn) {
  const k = longVals.length - shortVals.length;
  if (k <= 0 || !shortVals.length || !longVals.length) return 0;
  const cheapest = longVals.slice().sort((x, y) => x - y).slice(0, k);
  if (dyn) { const w = WAIVER.dynasty; return cheapest.reduce((s, v, i) => s + Math.floor(Math.min(v * w.pct, w.cap + i * w.step)), 0); }
  const w = WAIVER.redraft;
  return cheapest.reduce((s, v) => s + Math.min(Math.round(v * w.pct), w.cap), 0) + Math.max(0, (k - 1) * w.extra);
}
/* Each side's trade value: the plain sum of its assets, plus the waiver adjustment for the side getting fewer pieces. */
function sideTotals(aVals, bVals, dyn) {
  if (dyn == null) dyn = WAIVER_DYNASTY;
  const rawA = aVals.reduce((s, v) => s + (+v || 0), 0), rawB = bVals.reduce((s, v) => s + (+v || 0), 0);
  const adjA = waiverAdj(aVals, bVals, dyn), adjB = waiverAdj(bVals, aVals, dyn);
  return { rawA, rawB, adjA, adjB, ta: rawA + adjA, tb: rawB + adjB };
}
function fairness(a, b, dyn) {
  const s = sideTotals(a.map(p => p.value), b.map(p => p.value), dyn);
  const max = Math.max(s.ta, s.tb, 1);
  return Object.assign(s, { diff: s.tb - s.ta, pct: (s.tb - s.ta) / max });
}

function swapPlayers(players, out, inc) {
  const ids = new Set(out.map(p => p.id));
  return players.filter(p => !ids.has(p.id)).concat(inc.map(p => Object.assign({}, p, { slot: 20 })));
}

const tradeable = players => players.filter(p => (SKILL.includes(p.pos) || p.pos === 'PICK') && p.value >= 100 && p.slot !== 21).sort((a, b) => b.value - a.value);
const avgAge = ps => { const a = ps.filter(p => p.age); return a.length ? a.reduce((s, p) => s + p.age, 0) / a.length : null; };

function combos(arr, maxPair, triples) {
  const out = arr.map(p => [p]);
  const top = arr.filter(p => p.pos !== 'PICK').slice(0, maxPair).concat(arr.filter(p => p.pos === 'PICK').slice(0, 5));
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) out.push([top[i], top[j]]);
  if (triples) {
    const t3 = arr.filter(p => p.pos !== 'PICK').slice(0, 7).concat(arr.filter(p => p.pos === 'PICK').slice(0, 2));
    for (let i = 0; i < t3.length; i++) for (let j = i + 1; j < t3.length; j++) for (let k = j + 1; k < t3.length; k++) out.push([t3[i], t3[j], t3[k]]);
  }
  return out.map(c => ({ c, vals: c.map(p => p.value), v: c.reduce((s, p) => s + p.value, 0), n: c.length }));
}
const SHAPES_OK = { '1for1': 1, '1for2': 1, '2for1': 1, '2for2': 1, '3for1': 1, '1for3': 1 };
const assetAge = p => p.pos === 'PICK' ? 21.5 : p.age;
const avgAssetAge = ps => { const a = ps.map(assetAge).filter(Boolean); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
function teamMode(m, t) {
  if (m.lg.type !== 'dynasty') return 'contend';
  const set = m.lg.mode;
  if (set === 'contend' || set === 'rebuild') return set;
  return t.rank.starter <= Math.ceil(m.teams.length / 2) ? 'contend' : 'rebuild';
}

function tradeIdeas(m, opts) {
  opts = opts || {};
  const me = m.byId.get(m.lg.myTeamId);
  if (!me) return [];
  const slots = m.lg.slots, dyn = m.lg.type === 'dynasty';
  const mode = opts.mode || teamMode(m, me);
  const target = opts.target ? m.players.get(opts.target) : null;
  const shop = opts.shop ? m.players.get(opts.shop) : null;
  const wantShape = opts.shape || '';
  const triples = !wantShape || wantShape === '3for1' || wantShape === '1for3' || !!target || !!shop;
  let G = combos(tradeable(me.players.concat(me.picks || [])), 10, triples);
  if (shop) G = G.filter(x => x.c.some(p => p.id === shop.id));
  const all = [];
  for (const t of m.teams) {
    if (t.id === me.id || (opts.team != null && opts.team !== t.id)) continue;
    if (target && target.owner !== t.id) continue;
    let R = combos(tradeable(t.players.concat(t.picks || [])), 10, triples);
    if (target) R = R.filter(x => x.c.some(p => p.id === target.id));
    if (opts.need) R = R.filter(x => x.c.some(p => p.pos === opts.need));
    const res = [];
    for (const g of G) for (const r of R) {
      const shape = g.n + 'for' + r.n;
      if (!SHAPES_OK[shape] || (wantShape && wantShape !== shape)) continue;
      const st = sideTotals(g.vals, r.vals), ga = st.ta, ra = st.tb;
      if (Math.min(ga, ra) < 400) continue;
      const f = (ra - ga) / Math.max(ga, ra);
      if (f > (mode === 'rebuild' ? 0.1 : 0.06) || f < -0.08) continue;
      if (g.c.concat(r.c).every(p => p.pos === 'PICK')) continue;
      if (g.c.some(p => r.c.includes(p))) continue;
      const dMe = lineup(swapPlayers(me.players, g.c, r.c), slots).value - me.starterValue;
      let score;
      if (mode === 'rebuild') {
        const aG = avgAssetAge(g.c), aR = avgAssetAge(r.c);
        const youth = aG && aR ? aG - aR : 0;
        const picksIn = r.c.filter(p => p.pos === 'PICK').reduce((s, p) => s + p.value, 0);
        if (youth < 1 && !picksIn && !target && !shop) continue;
        score = (ra - ga) + youth * 250 + picksIn * 0.25 + Math.min(0, dMe) * 0.05;
        var dT = lineup(swapPlayers(t.players, r.c, g.c), slots).value - t.starterValue;
        score += 0.2 * dT;
      } else {
        const minGain = target || shop ? -Infinity : dyn ? 0 : Math.max(200, me.starterValue * 0.02);
        if (dMe < minGain) continue;
        var dT = lineup(swapPlayers(t.players, r.c, g.c), slots).value - t.starterValue;
        score = dMe + 0.45 * dT - Math.abs(f) * Math.max(ga, ra) * 0.6 - (g.n + r.n - 2) * Math.max(300, me.starterValue * 0.025);
        if (dyn) { const aG = avgAssetAge(g.c), aR = avgAssetAge(r.c); if (aG && aR) score += (aG - aR) * 80; }
        if (target) score = -Math.abs(f) * ga * 2 + dMe * 0.5 - (g.n - 1) * 200;
        if (shop) score = (ra - ga) + dMe * 0.5 + 0.3 * dT - (g.n - 1) * Math.max(900, ga * 0.2) - (r.n - 1) * 250 - Math.abs(f) * ga * 0.5;
      }
      res.push({ team: t, give: g.c, get: r.c, ga, ra, f, dMe, dT, score, mode });
    }
    res.sort((a, b) => b.score - a.score);
    const seenGet = new Set(), seenGive = new Set(), used = new Map();
    let n = 0;
    const cap = target ? 8 : shop ? 2 : opts.team != null ? 8 : 3;
    for (const x of res) {
      const kg = x.get.map(p => p.id).join(), kv = x.give.map(p => p.id).join();
      if ((!target && seenGet.has(kg)) || seenGive.has(kv)) continue;
      if (!target && x.give.concat(x.get).some(p => (!shop || p.id !== shop.id) && (used.get(p.id) || 0) >= (opts.team != null ? 3 : 1))) continue;
      x.give.concat(x.get).forEach(p => used.set(p.id, (used.get(p.id) || 0) + 1));
      seenGet.add(kg); seenGive.add(kv);
      all.push(x);
      if (++n >= cap) break;
    }
  }
  all.sort((a, b) => b.score - a.score);
  const uses = new Map(), picked = [];
  for (const x of all) {
    if (!shop && x.give.some(p => (uses.get(p.id) || 0) >= 2)) continue;
    x.give.forEach(p => uses.set(p.id, (uses.get(p.id) || 0) + 1));
    picked.push(x);
  }
  return picked.slice(0, target || opts.team != null ? 8 : shop ? 12 : 15);
}

function ideaReasons(x, me, n) {
  const out = [];
  const getPos = [...new Set(x.get.map(p => p.pos))].filter(p => p !== 'PICK'), givePos = [...new Set(x.give.map(p => p.pos))].filter(p => p !== 'PICK');
  const them = x.team.abbrev || x.team.name;
  getPos.forEach(p => {
    if (me.needs.includes(p)) out.push('Fills a need: you rank ' + ord(me.rank[p]) + ' of ' + n + ' at ' + p + '.');
    else out.push('Upgrades your ' + p + ' starters (you rank ' + ord(me.rank[p]) + ').');
  });
  givePos.forEach(p => {
    if (x.team.needs.includes(p)) out.push(them + ' ranks ' + ord(x.team.rank[p]) + ' at ' + p + ', so they should want this.');
    else if (me.surplus.includes(p)) out.push('You are deep at ' + p + ', so you can afford to move it.');
  });
  x.get.filter(p => p.pos === 'PICK').forEach(p => out.push('Adds draft capital: ' + p.name + (p.pickNo ? ' (pick ' + p.pickNo + ' of each round in the projected order)' : '') + '.'));
  x.give.filter(p => p.pos === 'PICK').forEach(p => out.push('Uses your ' + p.name + ' as part of the price, which costs your lineup nothing this season.'));
  if (x.mode === 'rebuild') {
    const aG = avgAssetAge(x.give), aR = avgAssetAge(x.get);
    if (aG && aR && aG - aR >= 1) out.push('Gets you ' + (aG - aR).toFixed(1) + ' years younger on average, which fits a rebuild.');
  }
  if (x.dT > 0) out.push('Their starting lineup gets better too, which makes it an easier sell.');
  return out;
}

/* Packages from a roster that match a target trade value (for "find me an offer"). */
function findPackages(players, targetVals, slots, baseLineup, exclude) {
  const pool = tradeable(players).filter(p => !exclude.has(p.id));
  const out = [];
  for (const { c, vals } of combos(pool, 12, true)) {
    const st = sideTotals(vals, targetVals), v = st.ta, target = st.tb;
    const f = (v - target) / Math.max(v, target);
    if (f < -0.05 || f > 0.12) continue;
    const loss = baseLineup - lineup(swapPlayers(players, c, []), slots).value;
    out.push({ give: c, v, f, loss, score: loss + Math.abs(f) * target * 2 + (c.length - 1) * 150 });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, 5);
}

/* Assets that bring a lopsided trade back to even, added to the short side. */
function balancers(sideShort, sideLong, pool, exclude) {
  const vals = sideShort.map(p => p.value), longVals = sideLong.map(p => p.value);
  return pool.filter(p => !exclude.has(p.id) && p.value > 0).map(p => {
    const st = sideTotals(vals.concat(p.value), longVals), nv = st.ta, target = st.tb;
    return { p, nv, gap: Math.abs(target - nv) / Math.max(target, nv) };
  }).sort((a, b) => a.gap - b.gap).slice(0, 3).filter(x => x.gap < 0.15);
}

/* ---------- Weekly tools ---------- */
function startSit(m, t) {
  const have = t.players.filter(p => p.proj != null);
  if (have.length < 5) return null;
  const best = lineup(t.players, m.lg.slots, 'proj');
  const startSlots = new Set(SLOT_ORDER.map(String));
  const current = t.players.filter(p => startSlots.has(String(p.slot)));
  const curPts = current.reduce((s, p) => s + (p.proj || 0), 0);
  const starters = best.starters.filter(s => s.p).map(s => s.p);
  const ins = starters.filter(p => !current.includes(p)), outs = current.filter(p => !best.used.has(p.id));
  ins.sort((a, b) => (b.proj || 0) - (a.proj || 0)); outs.sort((a, b) => (a.proj || 0) - (b.proj || 0));
  return { best, curPts, bestPts: best.value, ins, outs, gain: best.value - curPts };
}

function waiverTargets(m, t) {
  const dyn = m.lg.type === 'dynasty';
  const bench = t.players.filter(p => !t.lineup.used.has(p.id) && p.slot !== 21 && SKILL.concat(['K', 'D/ST']).includes(p.pos)).sort((a, b) => a.value - b.value);
  const drop = bench[0] || null;
  const pool = m.freeAgents.filter(p => p.value > 0 && SKILL.concat(['K', 'D/ST']).includes(p.pos)).sort((a, b) => b.value - a.value).slice(0, 80);
  const out = pool.map(p => {
    const roster = drop ? swapPlayers(t.players, [drop], [p]) : t.players.concat([p]);
    const gain = lineup(roster, m.lg.slots).value - t.starterValue;
    const projGain = p.proj != null ? lineup(roster, m.lg.slots, 'proj').value - lineup(t.players, m.lg.slots, 'proj').value : null;
    const upgrade = p.value - (drop ? drop.value : 0);
    const youth = dyn && p.age && drop && drop.age ? (drop.age - p.age) : 0;
    const score = dyn ? upgrade + youth * 60 + gain * 0.5 : gain + upgrade * 0.25 + (projGain || 0) * 40;
    return { p, gain, projGain, upgrade, score };
  }).filter(x => x.upgrade > 0 || x.gain > 0).sort((a, b) => b.score - a.score);
  return { drop, list: out.slice(0, 10) };
}

function playoffWeeks(lg) {
  const s = lg.sched || { reg: 14, poLen: 1, poTeams: 6 };
  const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, s.poTeams || 4))));
  const out = [];
  for (let w = (s.reg || 14) + 1; out.length < rounds * (s.poLen || 1) && w <= 18; w++) out.push(w);
  return out;
}
function playerSchedule(m, p) {
  const nfl = m.lg.nfl;
  if (!nfl || !nfl.teams || p.proTeam == null) return null;
  const paVals = Object.values(nfl.pa || {});
  const avgPA = paVals.length ? paVals.reduce((a, b) => a + b, 0) / paVals.length : null;
  return playoffWeeks(m.lg).map(w => {
    const tm = nfl.teams[p.proTeam];
    if (!tm) return { w, opp: null };
    const oid = tm.g[w];
    if (!oid) return { w, opp: 'BYE', ease: 0 };
    const o = nfl.teams[oid];
    const pa = o && nfl.pa ? nfl.pa[o.a] || nfl.pa[{ WSH: 'WAS', WAS: 'WSH' }[o.a]] : null;
    return { w, opp: o ? o.a : '?', pa, ease: pa && avgPA ? pa / avgPA : 1 };
  });
}
function scheduleStrength(m) {
  const nfl = m.lg.nfl;
  if (!nfl || !nfl.teams) return null;
  const weeks = playoffWeeks(m.lg);
  const paVals = Object.values(nfl.pa || {});
  const avgPA = paVals.length ? paVals.reduce((a, b) => a + b, 0) / paVals.length : null;
  const games = p => weeks.map(w => {
    const tm = nfl.teams[p.proTeam];
    if (!tm) return { w, opp: null };
    const oid = tm.g[w];
    if (!oid) return { w, opp: 'BYE', ease: 0 };
    const o = nfl.teams[oid];
    const pa = o && nfl.pa ? nfl.pa[o.a] || nfl.pa[{ WSH: 'WAS', WAS: 'WSH' }[o.a]] : null;
    return { w, opp: o ? o.a : '?', pa, ease: pa && avgPA ? pa / avgPA : 1 };
  });
  const teams = m.teams.map(t => {
    const starters = t.lineup.starters.filter(s => s.p && SKILL.includes(s.p.pos)).map(s => s.p);
    const rows = starters.map(p => ({ p, g: games(p) }));
    const all = [].concat(...rows.map(r => r.g.filter(g => g.opp)));
    const byes = all.filter(g => g.opp === 'BYE').length;
    const ease = all.length ? all.reduce((s, g) => s + g.ease, 0) / all.length : 1;
    return { t, rows, ease, byes };
  });
  teams.slice().sort((a, b) => b.ease - a.ease).forEach((x, i) => { x.rank = i + 1; });
  return { weeks, avgPA, teams };
}

/* ---------- Managers ---------- */
function managerProfiles(m) {
  const n = m.teams.length, trades = Array.isArray(m.lg.trades) ? m.lg.trades : [];
  const names = m.lg.players || {};
  const posOf = pid => { const p = m.players.get('e' + pid); if (p) return p.pos; const x = names[pid]; return x ? POS[x[1]] || '?' : '?'; };
  const nameOf = pid => { const p = m.players.get('e' + pid); if (p) return p.name; const x = names[pid]; return x ? x[0] : 'Player ' + pid; };
  const me = m.byId.get(m.lg.myTeamId);
  return m.teams.map(t => {
    const ages = t.lineup.starters.filter(s => s.p && s.p.age).map(s => s.p.age);
    const age = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;
    const mine = trades.filter(x => x.items.some(i => i[1] === t.id || i[2] === t.id));
    const got = {}, sent = {}, partners = {};
    mine.forEach(x => x.items.forEach(i => {
      const pos = posOf(i[0]);
      if (i[2] === t.id) got[pos] = (got[pos] || 0) + 1;
      if (i[1] === t.id) sent[pos] = (sent[pos] || 0) + 1;
      const other = i[1] === t.id ? i[2] : i[2] === t.id ? i[1] : null;
      if (other) partners[other] = 1;
    }));
    const history = mine.slice().sort((a, b) => b.d - a.d).slice(0, 3).map(x => ({
      d: x.d, got: x.items.filter(i => i[2] === t.id).map(i => nameOf(i[0])), sent: x.items.filter(i => i[1] === t.id).map(i => nameOf(i[0]))
    }));
    let fit = 0;
    const reasons = [];
    if (me && t.id !== me.id) {
      SKILL.forEach(p => {
        if (me.needs.includes(p) && t.surplus.includes(p)) { fit += 2; reasons.push('they can spare the ' + p + ' you need'); }
        if (t.needs.includes(p) && me.surplus.includes(p)) { fit += 2; reasons.push('they need ' + p + ', where you\'re deep'); }
      });
      if (m.lg.type === 'dynasty' && teamMode(m, t) !== teamMode(m, me)) { fit += 1; reasons.push(teamMode(m, t) === 'rebuild' ? 'they look like a rebuilder, so they may sell veterans' : 'they look like a contender, so they may pay for veterans'); }
      fit += Math.min(2, mine.length * 0.5);
    }
    return { t, age, mode: teamMode(m, t), trades: mine.length, got, sent, partners: Object.keys(partners).length, history, fit, reasons, tracked: trades.length > 0 };
  });
}

/* ---------- Matchup and playoff odds ---------- */
const SCORE_SD = 22;
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
function currentLineupProj(m, t) {
  const startSlots = new Set(SLOT_ORDER);
  const cur = t.players.filter(p => startSlots.has(+p.slot));
  return { players: cur, pts: cur.reduce((s, p) => s + (p.proj || 0), 0) };
}
function matchup(m) {
  const lg = m.lg, me = m.byId.get(lg.myTeamId);
  if (!me || !Array.isArray(lg.sch) || !lg.sch.length) return null;
  const mp = lg.mp || Math.max(...lg.sch.filter(g => g[5]).map(g => g[0]), 0) + 1;
  const g = lg.sch.find(x => x[0] === mp && (x[1] === me.id || x[2] === me.id));
  if (!g) return { mp, bye: true };
  const home = g[1] === me.id, opp = m.byId.get(home ? g[2] : g[1]);
  const a = currentLineupProj(m, me), b = currentLineupProj(m, opp);
  const havePj = me.players.some(p => p.proj != null);
  const live = [home ? g[3] : g[4], home ? g[4] : g[3]];
  const winP = havePj ? normCdf((a.pts - b.pts) / (SCORE_SD * Math.SQRT2)) : null;
  return { mp, me, opp, myProj: a.pts, oppProj: b.pts, myLine: a.players, oppLine: b.players, live, winP, havePj };
}
function playoffOdds(m, sims) {
  const lg = m.lg;
  if (!Array.isArray(lg.sch) || !lg.sch.length) return null;
  sims = sims || 4000;
  const reg = (lg.sched && lg.sched.reg) || 14, spots = (lg.sched && lg.sched.poTeams) || 4;
  const teams = m.teams;
  const played = {}, base = {};
  teams.forEach(t => { base[t.id] = { w: 0, l: 0, t: 0, pf: 0, g: 0 }; });
  lg.sch.forEach(g => {
    if (g[0] > reg || !g[5]) return;
    const h = base[g[1]], a = base[g[2]];
    if (!h || !a) return;
    h.pf += g[3]; a.pf += g[4]; h.g++; a.g++;
    if (g[5] === 1) { h.w++; a.l++; } else if (g[5] === 2) { a.w++; h.l++; } else { h.t++; a.t++; }
  });
  const remaining = lg.sch.filter(g => g[0] <= reg && !g[5] && base[g[1]] && base[g[2]]);
  /* Team strength: blend points per game so far with lineup projection when available. */
  const mean = {};
  teams.forEach(t => {
    const b = base[t.id];
    const ppg = b.g ? b.pf / b.g : null;
    const pj = currentLineupProj(m, t).pts || null;
    mean[t.id] = ppg && pj ? 0.6 * ppg + 0.4 * pj : ppg || pj || 100;
  });
  const made = {}, seed1 = {}, wins = {};
  teams.forEach(t => { made[t.id] = 0; seed1[t.id] = 0; wins[t.id] = 0; });
  let s = 12345;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  for (let i = 0; i < sims; i++) {
    const st = {};
    teams.forEach(t => { const b = base[t.id]; st[t.id] = { w: b.w + b.t * 0.5, pf: b.pf }; });
    remaining.forEach(g => {
      const hs = mean[g[1]] + gauss() * SCORE_SD, as = mean[g[2]] + gauss() * SCORE_SD;
      st[g[1]].pf += hs; st[g[2]].pf += as;
      if (hs > as) st[g[1]].w++; else st[g[2]].w++;
    });
    const order = teams.map(t => t.id).sort((a, b) => st[b].w - st[a].w || st[b].pf - st[a].pf);
    order.slice(0, spots).forEach(id => made[id]++);
    seed1[order[0]]++;
    teams.forEach(t => { wins[t.id] += st[t.id].w; });
  }
  return {
    spots, reg, remaining: remaining.length,
    rows: teams.map(t => ({ t, rec: base[t.id], ppg: base[t.id].g ? base[t.id].pf / base[t.id].g : 0, odds: made[t.id] / sims, top: seed1[t.id] / sims, projW: wins[t.id] / sims, strength: mean[t.id] }))
      .sort((a, b) => b.rec.w - a.rec.w || b.rec.pf - a.rec.pf)
  };
}

function ord(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* Demo league so the app opens in a working state before the first sync. */
function demoLeague(seedTxt) {
  const list = parseValues(seedTxt).filter(p => SKILL.includes(p.pos));
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pool = list.map(p => Object.assign({}, p, { adp: p.value * (0.8 + rnd() * 0.4) })).sort((a, b) => b.adp - a.adp);
  const names = ['Gridiron Gurus', 'Fourth & Long Shots', 'Red Zone Rejects', 'Blitz Krieg', 'Pocket Aces', 'Hail Mary Hopefuls', 'The Waiver Wire', 'Turf Toe Truckers', 'Two-Minute Drill', 'Punt Intended', 'Screen Pass Society', 'Goal Line Stand'];
  const caps = { QB: 2, RB: 6, WR: 6, TE: 2 };
  const teams = names.map((n, i) => ({ id: i + 1, name: n, abbrev: n.split(' ').map(w => w[0]).join('').slice(0, 4).toUpperCase(), owner: i === 0 ? 'You' : '', mine: i === 0, w: 0, l: 0, t: 0, pf: 0, roster: [], cnt: { QB: 0, RB: 0, WR: 0, TE: 0 } }));
  const posId = { QB: 1, RB: 2, WR: 3, TE: 4 };
  for (let rd = 0; rd < 14; rd++) {
    const order = rd % 2 ? teams.slice().reverse() : teams;
    for (const t of order) {
      const i = pool.findIndex(p => t.cnt[p.pos] < caps[p.pos]);
      if (i < 0) continue;
      const p = pool.splice(i, 1)[0];
      t.cnt[p.pos]++;
      t.roster.push([+p.espn || p.key, p.name, posId[p.pos], 0, 20, '']);
    }
  }
  /* Starting lineups, weekly projections and a played-out schedule so every screen has content. */
  const val = new Map(list.map(p => [String(+p.espn || p.key), p.value]));
  const need = { 1: [0], 2: [2, 2], 3: [4, 4], 4: [6] };
  teams.forEach(t => {
    const sorted = t.roster.slice().sort((a, b) => (val.get(String(b[0])) || 0) - (val.get(String(a[0])) || 0));
    const used = new Set(); let flex = false;
    const left = { 1: 1, 2: 2, 3: 2, 4: 1 };
    sorted.forEach(r => {
      const v = val.get(String(r[0])) || 0;
      r[7] = Math.round((v / 520 + 3 + rnd() * 6) * 10) / 10;
      r[8] = Math.round((v / 560 + 4 + rnd() * 3) * 10) / 10;
      r[6] = Math.min(99.9, Math.round(v / 90 + 20));
      if (left[r[2]] > 0) { r[4] = need[r[2]][0]; left[r[2]]--; used.add(r); }
      else if (!flex && r[2] !== 1) { r[4] = 23; flex = true; used.add(r); }
    });
    t.strength = sorted.filter(r => used.has(r)).reduce((s, r) => s + r[7], 0);
    delete t.cnt;
  });
  const ids = teams.map(t => t.id), sch = [], n = ids.length;
  for (let wk = 1; wk <= 14; wk++) {
    const rot = [ids[0]].concat(ids.slice(1).map((_, i) => ids[1 + ((i + wk - 1) % (n - 1))]));
    for (let i = 0; i < n / 2; i++) {
      const h = teams[rot[i] - 1], a = teams[rot[n - 1 - i] - 1];
      if (wk <= 11) {
        const hs = Math.round((h.strength * 1.05 + (rnd() - 0.5) * 50) * 10) / 10, as = Math.round((a.strength * 1.05 + (rnd() - 0.5) * 50) * 10) / 10;
        sch.push([wk, h.id, a.id, hs, as, hs > as ? 1 : 2]);
      } else sch.push([wk, h.id, a.id, 0, 0, 0]);
    }
  }
  teams.forEach(t => { t.w = 0; t.l = 0; t.pf = 0; });
  sch.forEach(g => { if (!g[5]) return; const h = teams[g[1] - 1], a = teams[g[2] - 1]; h.pf += g[3]; a.pf += g[4]; if (g[5] === 1) { h.w++; a.l++; } else { a.w++; h.l++; } });
  teams.forEach(t => { t.pf = Math.round(t.pf); delete t.strength; });
  return {
    id: 'demo', demo: true, season: 2026, name: 'Demo League', size: 12, ppr: 1, qbs: 1,
    slots: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 1, 17: 1, 20: 7 }, type: 'redraft', myTeamId: 1,
    teams, syncedAt: 2, values: null, week: 12, mp: 12, sch, sched: { reg: 14, poLen: 1, poTeams: 6 },
    trades: [
      { d: Date.parse('2026-10-14'), items: [[teams[2].roster[1][0], 7, 3], [teams[6].roster[2][0], 3, 7]] },
      { d: Date.parse('2026-09-30'), items: [[teams[0].roster[4][0], 9, 1], [teams[8].roster[3][0], 1, 9], [teams[8].roster[6][0], 1, 9]] }
    ]
  };
}

if (typeof module !== 'undefined') module.exports = { applyNews, matchup, playoffOdds, playerSchedule, startSit, waiverTargets, playoffWeeks, scheduleStrength, managerProfiles, teamMode, draftPicks, draftOrder, parseValues, indexValues, buildModel, lineup, tv, fairness, tradeIdeas, ideaReasons, findPackages, balancers, demoLeague, swapPlayers, ord, nk };
