/* ---------- App UI ---------- */
const SEED_ASOF = '2026-11-23T12:00:00';
const SEED = { redraft: __SEED_R__, dynasty: __SEED_D__ };
const BOOKMARKLET = __BM__;
const LS = 'ftd.v1';
const NEWS = __NEWS__;
const PWA = __PWA__;

let S = { leagues: {}, order: [], active: null, values: null, updated: 0 };
const store = { mode: 'local', db: null, uid: null, chain: Promise.resolve(), dirty: new Set(), timer: null };
const ui = { view: 'team', teamView: null, ideaTeam: '', ideaShape: '', calc: { a: [], b: [], aTeam: null, bTeam: null }, search: { side: null, q: '' } };

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n || 0).toLocaleString('en-US');
const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const when = t => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

/* ----- storage ----- */
function loadLocal() {
  try { const j = JSON.parse(localStorage.getItem(LS) || 'null'); if (j && j.leagues) S = Object.assign(S, j); } catch (e) {}
}
function save(changed) {
  S.updated = Date.now();
  try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {}
  if (store.mode === 'account') {
    (changed || []).forEach(id => store.dirty.add(id));
    clearTimeout(store.timer);
    store.timer = setTimeout(() => { store.chain = store.chain.then(flushRemote); }, 700);
  }
}
const ucol = () => store.db.collection('data/users/' + store.uid);
const ldoc = id => 'league-' + String(id).replace(/[^A-Za-z0-9_-]/g, '_');
async function flushRemote() {
  try {
    const ids = [...store.dirty]; store.dirty.clear();
    for (const id of ids) {
      const ref = ucol().doc(ldoc(id));
      if (S.leagues[id]) await ref.set({ json: JSON.stringify(S.leagues[id]) }); else await ref.delete();
    }
    await ucol().doc('meta').set({ order: S.order, active: S.active, updated: S.updated, values: S.values ? JSON.stringify(S.values) : '' });
  } catch (e) {
    store.mode = 'local';
  }
  renderHeader();
}
const timeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
async function connect() {
  if (!(window.claude && window.claude.use)) return;
  try {
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user) return;
    const uid = await user.id();
    if (!uid) return;
    store.db = db; store.uid = uid;
    const meta = await timeout(ucol().doc('meta').get(), 10000);
    store.mode = 'account';
    if (meta.exists && (meta.data().updated || 0) > (S.updated || 0)) {
      const m = meta.data(), leagues = {};
      for (const id of m.order || []) {
        const d = await ucol().doc(ldoc(id)).get();
        if (d.exists) { try { leagues[id] = JSON.parse(d.data().json); } catch (e) {} }
      }
      S = { leagues, order: (m.order || []).filter(id => leagues[id]), active: m.active, values: m.values ? JSON.parse(m.values) : null, updated: m.updated };
      try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {}
      ensureLeague();
      render();
    } else if (S.order.some(id => id !== 'demo')) {
      S.order.forEach(id => store.dirty.add(id));
      store.chain = store.chain.then(flushRemote);
    }
    renderHeader();
  } catch (e) { store.mode = 'local'; renderHeader(); }
}

/* ----- model ----- */
const vsCache = new Map();
const modelCache = new Map();
function valueSource(lg) {
  const type = lg && lg.type === 'dynasty' ? 'dynasty' : 'redraft';
  const p = v => (v.ppr === 1 ? 'PPR' : v.ppr === 0.5 ? 'half-PPR' : 'standard') + (v.qbs === 2 ? ', superflex' : '');
  if (lg && lg.values && lg.values[type]) return { type, txt: lg.values[type], asOf: lg.values.asOf, desc: lg.values.teams + '-team ' + p(lg.values) };
  if (S.values && S.values[type]) return { type, txt: S.values[type], asOf: S.values.asOf, desc: '12-team PPR' };
  return { type, txt: SEED[type], asOf: SEED_ASOF, desc: '12-team PPR', seed: true };
}
function idx(txt) {
  let v = vsCache.get(txt);
  if (!v) { v = indexValues(parseValues(txt)); vsCache.set(txt, v); }
  return v;
}
function getVS(lg) {
  const src = valueSource(lg);
  const other = valueSource(Object.assign({}, lg, { type: src.type === 'dynasty' ? 'redraft' : 'dynasty' }));
  return Object.assign({ src, alt: idx(other.txt) }, idx(src.txt));
}
function model() { return modelFor(S.leagues[S.active]); }
function modelFor(lg) {
  if (!lg) return null;
  const vs = getVS(lg);
  const key = [lg.id, lg.mode || '', JSON.stringify(lg.valueOverrides || {}), lg.type, lg.syncedAt, vs.src.asOf, vs.src.txt.length, lg.myTeamId, lg.pickRounds || 3, JSON.stringify(lg.pickOwners || {}), JSON.stringify(lg.manualTrades || [])].join('|');
  WAIVER_DYNASTY = lg.type === 'dynasty';
  let c = modelCache.get(lg.id);
  if (!c || c.key !== key) { c = { key, m: buildModel(lg, vs) }; modelCache.set(lg.id, c); }
  return c.m;
}
function ensureLeague() {
  if (!S.order.length) {
    const d = demoLeague(SEED.redraft);
    S.leagues.demo = d; S.order = ['demo'];
  }
  if (!S.leagues[S.active]) S.active = S.order[0];
}
function asset(m, id) {
  return m.players.get(id) || m.vs.byId.get(id) || null;
}

/* ----- import ----- */
function importText(txt) {
  let j;
  try { j = JSON.parse(String(txt).trim()); } catch (e) { return { ok: false, msg: 'That doesn’t look like data from the sync bookmark. Click the bookmark on your ESPN league page, press “Copy league data”, then paste here.' }; }
  if (!j || j.ffo !== 2) return { ok: false, msg: 'That data isn’t from this app’s sync bookmark. Reinstall the bookmark from this page and try again.' };
  if (j.league) {
    const L = j.league, prev = S.leagues[L.id] || {};
    const guessDyn = L.keepers && L.keepers >= 10;
    const mineT = L.teams.find(t => t.mine);
    /* Snapshot the rosters before this sync, for the rival tracker. */
    let prevSnap = prev.prev || null;
    try { if (prev.teams) prevSnap = rosterSnapshot(prev, modelFor(prev)); } catch (e) {}
    const keep = {};
    ['pickOwners', 'valueOverrides', 'pickRounds', 'mode', 'block', 'rivals', 'history', 'manualTrades'].forEach(k => { if (prev[k] != null) keep[k] = prev[k]; });
    S.leagues[L.id] = Object.assign({}, L, keep, {
      type: prev.type || (guessDyn ? 'dynasty' : 'redraft'),
      myTeamId: prev.myTeamId != null ? prev.myTeamId : (mineT ? mineT.id : null),
      values: j.values || prev.values || null,
      prev: prevSnap,
      syncedAt: Date.now()
    });
    try { recordHistory(S.leagues[L.id]); } catch (e) {}
    const changed = [L.id];
    if (!S.order.includes(L.id)) S.order.push(L.id);
    if (S.leagues.demo) { delete S.leagues.demo; S.order = S.order.filter(x => x !== 'demo'); changed.push('demo'); }
    S.active = L.id;
    save(changed);
    const lg = S.leagues[L.id];
    return { ok: true, msg: 'Synced ' + L.name + ': ' + L.teams.length + ' teams' + (j.values ? ' and fresh trade values' : '') + '.', needTeam: lg.myTeamId == null, id: L.id };
  }
  if (j.values) {
    S.values = j.values;
    save([]);
    return { ok: true, msg: 'Trade values updated (' + when(j.values.asOf) + ').' };
  }
  return { ok: false, msg: 'Nothing to import in that data.' };
}

/* ----- small renderers ----- */
const posChip = p => '<span class="pos pos-' + esc(String(p).replace('/', '')) + '">' + esc(p) + '</span>';
function trendTag(t, v) {
  if (!v || Math.abs(t) < Math.max(250, v * 0.08)) return '';
  return t > 0 ? '<span class="trend up" title="30-day value change">▲ ' + fmt(t) + '</span>' : '<span class="trend down" title="30-day value change">▼ ' + fmt(-t) + '</span>';
}
function rankChip(r, n) {
  const cls = r <= Math.ceil(n * 0.35) ? 'good' : r > Math.ceil(n * 0.6) ? 'bad' : 'mid';
  return '<span class="rank ' + cls + '">' + ord(r) + '</span>';
}
/* NFL team colors (primary, secondary) for badges and avatars. No logos or photos. */
const TEAM_COLORS = {
  ARI: ['#97233F', '#FFB612'], ATL: ['#A71930', '#000000'], BAL: ['#241773', '#9E7C0C'], BUF: ['#00338D', '#C60C30'], CAR: ['#0085CA', '#101820'],
  CHI: ['#0B162A', '#C83803'], CIN: ['#FB4F14', '#000000'], CLE: ['#311D00', '#FF3C00'], DAL: ['#003594', '#869397'], DEN: ['#FB4F14', '#002244'],
  DET: ['#0076B6', '#B0B7BC'], GB: ['#203731', '#FFB612'], HOU: ['#03202F', '#A71930'], IND: ['#002C5F', '#A2AAAD'], JAX: ['#006778', '#D7A22A'],
  KC: ['#E31837', '#FFB81C'], LV: ['#000000', '#A5ACAF'], LAC: ['#0080C6', '#FFC20E'], LAR: ['#003594', '#FFA300'], MIA: ['#008E97', '#FC4C02'],
  MIN: ['#4F2683', '#FFC62F'], NE: ['#002244', '#C60C30'], NO: ['#101820', '#D3BC8D'], NYG: ['#0B2265', '#A71930'], NYJ: ['#125740', '#FFFFFF'],
  PHI: ['#004C54', '#A5ACAF'], PIT: ['#101820', '#FFB612'], SF: ['#AA0000', '#B3995D'], SEA: ['#002244', '#69BE28'], TB: ['#D50A0A', '#34302B'],
  TEN: ['#0C2340', '#4B92DB'], WAS: ['#5A1414', '#FFB612']
};
const teamColors = abbr => { const a = String(abbr || '').toUpperCase(); return TEAM_COLORS[a === 'WSH' ? 'WAS' : a] || ['#3a3d44', '#6b717b']; };
const initials = n => { const w = String(n || '').replace(/\b(Jr\.?|Sr\.?|II|III|IV|V)\b/g, '').replace(/D\/ST/, '').trim().split(/\s+/).filter(w => /[A-Za-z]/.test(w)); return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); };
function avatar(p, size) {
  if (p.pos === 'PICK') return '<span class="av pick ' + (size || '') + '">' + (p.round ? 'R' + p.round : 'PK') + '</span>';
  /* NFL team crest built from the team's colors and abbreviation (official logos aren't used). */
  const abbr = String(p.team || '').toUpperCase().replace(/^WSH$/, 'WAS');
  if (!TEAM_COLORS[abbr]) return '<span class="av fa ' + (size || '') + '" aria-hidden="true">FA</span>';
  const [c1, c2] = teamColors(abbr);
  return jerseyIcon(p, abbr, c1, c2, size);
}
/* Mini jersey in the player's team colors with his number (or the team abbreviation when the number isn't known). */
function jerseyIcon(p, abbr, c1, c2, size) {
  const num = JERSEYS && JERSEYS.n && p.espn ? JERSEYS.n[String(p.espn)] : null;
  const label = num != null ? String(num) : abbr;
  const fs = num != null ? (label.length > 1 ? 15 : 17) : (label.length > 2 ? 9 : 11);
  const light = /^#(f|e|d)/i.test(c1) || c1.toUpperCase() === '#FFB612';
  return '<span class="av jersey ' + (size || '') + '" aria-hidden="true"><svg viewBox="0 0 40 40" width="100%" height="100%">' +
    '<path d="M14 4.5 L17 3 Q20 6.2 23 3 L26 4.5 L36.5 10 L33 18.5 L29.5 17 L29.5 37 L10.5 37 L10.5 17 L7 18.5 L3.5 10 Z" fill="' + c1 + '" stroke="' + c2 + '" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M17 3 Q20 6.2 23 3 L21.6 7.6 Q20 8.6 18.4 7.6 Z" fill="' + c2 + '"/>' +
    '<path d="M5.4 13.6 L9.2 15.4 M34.6 13.6 L30.8 15.4" stroke="' + c2 + '" stroke-width="2.2" stroke-linecap="round"/>' +
    '<text x="20" y="' + (num != null ? 28.5 : 26.5) + '" text-anchor="middle" font-family="var(--display)" font-weight="800" font-size="' + fs + '" fill="' + (light ? '#111' : '#fff') + '" stroke="' + c2 + '" stroke-width="' + (num != null ? 0.9 : 0.5) + '" paint-order="stroke">' + esc(label) + '</text></svg></span>';
}
function teamBadge(abbr) {
  if (!abbr || abbr === 'FA') return '<span class="tb" style="background:#3a3d44">FA</span>';
  const [c1, c2] = teamColors(abbr);
  return '<span class="tb" style="background:' + c1 + ';--ring:' + c2 + '">' + esc(abbr) + '</span>';
}
function fteamAvatar(t, size) {
  if (!t) return '';
  let h = 0; for (const ch of String(t.name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const txt = String(t.abbrev || t.name || '?').slice(0, size === 'xs' ? 2 : 4);
  const src = logoSrc(t.logo);
  const logo = src ? '<img class="av-img" src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '';
  return '<span class="av ' + (size || '') + (logo ? ' has-img' : '') + '" style="background:hsl(' + h + ' 55% 34%);--ring:hsl(' + h + ' 65% 62%);' + (txt.length > 3 && size !== 'xs' ? 'font-size:10px' : '') + '" aria-hidden="true">' + esc(txt) + logo + '</span>';
}
/* Team pictures uploaded in ESPN. If one can't load (or the page blocks outside images), fall back to initials. */
/* Some uploaded pictures live on sites that block outside apps or only serve http. Those go through a free
   public image proxy (images.weserv.nl), which re-serves the same public picture over https. */
const BADLOGO = new Set(), PROXIED = new Set();
const proxyUrl = u => 'https://images.weserv.nl/?w=128&h=128&fit=cover&url=' + encodeURIComponent(u.replace(/^https?:\/\//, ''));
function logoSrc(u) {
  u = typeof normLogo === 'function' ? normLogo(u) : u;
  if (!u || BADLOGO.has(u)) return '';
  if (PROXIED.has(u) || /^http:/i.test(u)) return proxyUrl(u);
  return u;
}
document.addEventListener('error', e => {
  const img = e.target;
  if (!img || !img.classList || !img.classList.contains('av-img')) return;
  const src = img.getAttribute('src');
  if (src.startsWith('https://images.weserv.nl/')) {
    const orig = decodeURIComponent(src.split('&url=')[1] || '');
    [...PROXIED].forEach(u => { if (u.replace(/^https?:\/\//, '') === orig) BADLOGO.add(u); });
    const p = img.parentNode; img.remove(); if (p) p.classList.remove('has-img');
  } else { PROXIED.add(src); img.setAttribute('src', proxyUrl(src)); }
}, true);
const INJ_SHORT = { INJURY_RESERVE: 'IR', OUT: 'O', QUESTIONABLE: 'Q', DOUBTFUL: 'D', SUSPENSION: 'SUSP', DAY_TO_DAY: 'DTD' };
function playerLine(p, opts) {
  opts = opts || {};
  const dyn = opts.dyn && p.age ? '<span class="age">' + p.age.toFixed(1) + ' yrs</span>' : '';
  const est = p.est ? '<span class="estb' + (p.est === 'manual' ? ' man' : '') + '" title="' + esc(p.estWhy || '') + '">' + (p.est === 'manual' ? 'your value' : p.est === 'season' ? 'out for season' : 'est.') + '</span>' : '';
  return '<div class="pl" data-act="player" data-id="' + esc(p.id) + '" role="button" tabindex="0">' + avatar(p, opts.size) + '<div class="pl-text"><div class="pl-main"><span class="pl-name">' + esc(p.name) + '</span>' +
    (p.inj ? '<span class="inj" title="' + esc(p.inj.replace('_', ' ').toLowerCase()) + '">' + esc(INJ_SHORT[p.inj] || p.inj.slice(0, 3)) + '</span>' : '') + '</div>' +
    '<div class="pl-meta">' + posChip(p.pos) + (p.pos === 'PICK' ? '<span>' + esc(p.team || 'Draft pick') + '</span>' : teamBadge(p.team)) + dyn + trendTag(p.trend, p.value) + est + (p.news ? '<span class="newsb" title="' + esc(p.news.note) + '">news</span>' : '') + '</div></div></div>';
}
const teamName = t => esc(t ? t.name : '');

/* ----- header ----- */
function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago';
}
function syncButton() {
  const real = S.order.filter(id => !S.leagues[id].demo);
  const oldest = Math.min(...real.map(id => S.leagues[id].syncedAt || 0));
  return '<button class="ltab syncb' + (syncing ? ' busy' : '') + '" data-act="pwaSyncAll" aria-label="Sync all leagues now"><span class="spin" aria-hidden="true">⟳</span>' + (syncing ? 'Syncing…' : 'Synced ' + ago(oldest)) + '</button>';
}
function renderHeader() {
  const lg = S.leagues[S.active];
  $('#leagueTabs').innerHTML = '<button class="ltab gs" data-act="gsearch" aria-label="Search players"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>Search</button>' + S.order.map(id => {
    const l = S.leagues[id];
    return '<button class="ltab' + (id === S.active ? ' on' : '') + '" data-act="league" data-id="' + esc(id) + '">' + esc(l.name) + '<small>' + (l.demo ? 'demo' : l.type) + '</small></button>';
  }).join('') + (PWA && S.order.some(id => !S.leagues[id].demo) ? syncButton() : '') + '<a class="ltab add" href="#sync">' + (PWA && S.order.some(id => !S.leagues[id].demo) ? '+ League' : '+ Sync league') + '</a>';
  if (lg) {
    const src = valueSource(lg);
    $('#valuesNote').innerHTML = 'FantasyCalc ' + esc(src.type) + ' values · ' + esc(src.desc) + ' · ' + when(src.asOf) +
      ' · <span class="savemode">' + (store.mode === 'account' ? 'Saved to your Claude account' : 'Saved in this browser') + '</span>';
  }
  const parent = ui.view === 'outlook' ? 'league' : (subtabGroups().find(g => g.some(x => x[0] === ui.view)) || [[ui.view]])[0][0];
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === parent));
  const b = $('#banner');
  if (lg && lg.demo) b.innerHTML = '<div class="banner">You’re exploring a <b>demo league</b> built from real FantasyCalc values. <a href="#sync">Sync your ESPN leagues</a> to see your own rosters.</div>';
  else if (lg && lg.myTeamId == null) b.innerHTML = '<div class="banner warn">Which team is yours? ' + teamSelect('setMine', null, 'Pick your team') + '</div>';
  else b.innerHTML = '';
}
function teamSelect(act, val, placeholder, exclude) {
  const lg = S.leagues[S.active];
  return '<select data-act="' + act + '" aria-label="' + esc(placeholder) + '"><option value="">' + esc(placeholder) + '</option>' +
    lg.teams.filter(t => t.id !== exclude).map(t => '<option value="' + t.id + '"' + (t.id === val ? ' selected' : '') + '>' + esc(t.name) + (t.owner ? ' (' + esc(t.owner) + ')' : '') + '</option>').join('') + '</select>';
}

/* ----- views ----- */
function viewTeam(m) {
  const n = m.teams.length, dyn = m.lg.type === 'dynasty';
  const tid = ui.teamView != null ? ui.teamView : (m.lg.myTeamId != null ? m.lg.myTeamId : m.teams[0].id);
  const t = m.byId.get(+tid) || m.teams[0];
  const isMe = t.id === m.lg.myTeamId;
  const maxPos = {};
  SKILL.forEach(p => { maxPos[p] = Math.max(...m.teams.map(x => x.pos[p]), 1); });
  const avgPos = {};
  SKILL.forEach(p => { avgPos[p] = m.teams.reduce((a, x) => a + x.pos[p], 0) / n; });
  const tiles = [
    ['Starting lineup', ord(t.rank.starter) + ' of ' + n, fmt(t.starterValue) + ' value'],
    ['Whole roster', ord(t.rank.total) + ' of ' + n, fmt(t.totalValue) + ' value'],
    ['Record', t.w + '–' + t.l + (t.t ? '–' + t.t : ''), t.pf ? fmt(t.pf) + ' points for' : ''],
    ['Needs', t.needs.length ? t.needs.join(', ') : 'None', t.needs.length ? 'Bottom third of the league' : 'No weak spots'],
    ['Can spare', t.surplus.length ? t.surplus.join(', ') : 'Nothing extra', 'Strong or deep spots']
  ];
  const bars = SKILL.map(p => {
    const w = Math.round(t.pos[p] / maxPos[p] * 100), a = Math.round(avgPos[p] / maxPos[p] * 100);
    return '<div class="pbar"><div class="pbar-l">' + posChip(p) + rankChip(t.rank[p], n) + '</div><div class="pbar-track"><div class="pbar-fill ' + (t.needs.includes(p) ? 'bad' : t.surplus.includes(p) ? 'good' : '') + '" style="width:' + w + '%"></div><div class="pbar-avg" style="left:' + a + '%" title="League average"></div></div><div class="pbar-v">' + fmt(t.pos[p]) + '</div></div>';
  }).join('');
  const vcell = p => '<button class="vbtn" data-act="editVal" data-id="' + esc(p.id) + '" title="Change this value">' + fmt(p.value) + '</button>';
  const starters = t.lineup.starters.map(s => '<tr><td class="slot">' + esc(SLOT_NAME[s.slot]) + '</td><td>' + (s.p ? playerLine(s.p, { dyn }) : '<span class="muted">Empty</span>') + '</td><td class="num">' + (s.p ? vcell(s.p) : '') + '</td></tr>').join('');
  const bench = t.players.filter(p => !t.lineup.used.has(p.id)).sort((a, b) => b.value - a.value)
    .map(p => '<tr><td class="slot">' + (p.slot === 21 ? 'IR' : 'BN') + '</td><td>' + playerLine(p, { dyn }) + '</td><td class="num">' + vcell(p) + '</td></tr>').join('');
  return '<section class="head-row"><div class="tcell">' + fteamAvatar(t, 'lg') + '<div><h2>' + teamName(t) + '</h2><div class="muted small">' + (isMe ? 'Your team' : esc(t.owner || '')) + ' · ' + t.w + '–' + t.l + (t.t ? '–' + t.t : '') + '</div></div></div><div class="ctrl">' + teamSelect('teamView', t.id, 'View another team') + '</div></section>' +
    '<div class="tiles">' + tiles.map(x => '<div class="tile"><div class="tile-k">' + x[0] + '</div><div class="tile-v">' + esc(x[1]) + '</div><div class="tile-s">' + esc(x[2]) + '</div></div>').join('') + '</div>' +
    '<div class="grid2"><section class="card"><h3>Starter strength by position</h3><p class="muted small">Total trade value of the starters at each spot, ranked against the league. The tick mark is the league average.</p>' + bars + '</section>' +
    '<section class="card"><h3>Best lineup by trade value</h3><p class="muted small">Tap any value to change it. “est. value” marks players FantasyCalc doesn’t value, so the app estimated one.</p><table class="roster"><tbody>' + starters + '</tbody></table><h3 class="mt">Bench</h3><table class="roster"><tbody>' + bench + '</tbody></table></section></div>' +
    (dyn ? picksCard(m, t) : '') + valueChart(m, t) + (isMe ? offseasonCard(m, t) : '') +
    (isMe ? '' : '<p class="mt"><button class="btn" data-act="tradeWith" data-id="' + t.id + '">Find trades with ' + teamName(t) + '</button></p>');
}

function viewIdeas(m) {
  const me = m.byId.get(m.lg.myTeamId);
  if (!me) return '<section class="card"><h2>Trade ideas</h2><p>Choose your team first so the app knows whose roster to improve.</p>' + teamSelect('setMine', null, 'Pick your team') + '</section>';
  const tgt = ui.ideaTarget ? m.players.get(ui.ideaTarget) : null;
  const shop = !tgt && ui.ideaShop ? m.players.get(ui.ideaShop) : null;
  const opts = { team: tgt ? null : (ui.ideaTeam ? +ui.ideaTeam : null), shape: ui.ideaShape || null, need: ui.ideaNeed || null, target: tgt ? tgt.id : null, shop: shop ? shop.id : null };
  const dynI = m.lg.type === 'dynasty', mode = teamMode(m, me);
  const list = ideasWithBlock(m, opts, tradeIdeas(m, opts));
  const n = m.teams.length;
  const bl = buyLowSellHigh(m, me);
  const cards = list.map((x, i) => {
    const pct = Math.round(x.f * 100);
    const fairTxt = Math.abs(pct) <= 2 ? 'Even' : pct > 0 ? 'You gain ' + pct + '%' : 'You pay ' + (-pct) + '% extra';
    return '<article class="idea"><div class="idea-top"><span class="idea-team">' + fteamAvatar(x.team, 'sm') + teamName(x.team) + '</span>' + (x.blockHits ? '<span class="fair good">Trade block</span>' : '') + '<span class="fair ' + (Math.abs(pct) <= 3 ? 'good' : 'mid') + '">' + fairTxt + '</span></div>' +
      '<div class="idea-sides"><div><div class="side-k">You give</div>' + x.give.map(p => playerLine(p, { dyn: m.lg.type === 'dynasty' })).join('') + '<div class="side-v">' + fmt(x.ga) + '</div></div>' +
      '<div class="arrow" aria-hidden="true">⇄</div><div><div class="side-k">You get</div>' + x.get.map(p => playerLine(p, { dyn: m.lg.type === 'dynasty' })).join('') + '<div class="side-v">' + fmt(x.ra) + '</div></div></div>' +
      '<div class="impact"><span class="' + (x.dMe >= 0 ? 'pos-d' : 'neg-d') + '">Your starters ' + sgn(x.dMe) + '</span><span class="' + (x.dT >= 0 ? 'pos-d' : 'neg-d') + '">Theirs ' + sgn(x.dT) + '</span></div>' +
      '<ul class="why">' + ideaReasons(x, me, n).map(r => '<li>' + esc(r) + '</li>').join('') + '</ul>' +
      '<button class="btn ghost" data-act="openIdea" data-i="' + i + '">Open in calculator</button></article>';
  }).join('');
  ui._ideas = list;
  const sel = (act, val, items) => '<select data-act="' + act + '" aria-label="' + act + '">' + items.map(o => '<option value="' + o[0] + '"' + ((val || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';
  const autoMode = (m.lg.mode || 'auto') === 'auto';
  const controls = '<div class="ctrl">' +
    (dynI ? sel('leagueMode', m.lg.mode || 'auto', [['auto', 'Strategy: auto (' + (mode === 'contend' ? 'contender' : 'rebuilder') + ')'], ['contend', 'Strategy: win now'], ['rebuild', 'Strategy: rebuild']]) : '') +
    (tgt ? '' : teamSelect('ideaTeam', opts.team, 'All teams', me.id)) +
    sel('ideaNeed', ui.ideaNeed, [['', 'Any position'], ['QB', 'Need a QB'], ['RB', 'Need an RB'], ['WR', 'Need a WR'], ['TE', 'Need a TE']].concat(dynI ? [['PICK', 'Want picks']] : [])) +
    sel('ideaShape', ui.ideaShape, [['', 'Any shape'], ['1for1', '1-for-1'], ['2for1', '2-for-1 (consolidate)'], ['3for1', '3-for-1 (consolidate)'], ['2for2', '2-for-2'], ['1for2', '1-for-2 (add depth)'], ['1for3', '1-for-3 (add depth)']]) + '</div>';
  const box = (key, label, sel, ph, clearAct) => '<div class="target-row"><label class="small tlabel" for="q-' + key + '"><b>' + label + '</b></label>' +
    (sel ? '<span class="tchip">' + avatar(sel, 'sm') + ' ' + esc(sel.name) + (sel.owner !== me.id ? ' · ' + teamName(m.byId.get(sel.owner)) : '') + ' <button class="x" data-act="' + clearAct + '" aria-label="Clear">×</button></span>' :
      '<div class="search grow"><input id="q-' + key + '" type="search" autocomplete="off" placeholder="' + ph + '" data-side="' + key + '" value="' + (ui.search.side === key ? esc(ui.search.q) : '') + '"><div class="results" id="r-' + key + '"></div></div>') + '</div>';
  const targetBox = '<div class="card target">' + box('s', 'Trade a player', shop, 'Pick one of your players' + (dynI ? ' or picks' : '') + ' to shop…', 'clearShop') +
    box('t', 'Target a player', tgt, 'Search any player on another team…', 'clearTarget') + '</div>';
  const lead = shop ? 'The best fair offers you could get for ' + esc(shop.name) + ' from every team, ranked by value back and what it does to your lineup. Add more from your side, or use the filters to ask for a position or picks.' : tgt ? 'Fair offers for ' + esc(tgt.name) + ' from your roster' + (dynI ? ' and picks' : '') + ', ranked by how close they are in value and how little they hurt your lineup.' :
    (mode === 'rebuild' ? 'Rebuild mode: fair trades that make you younger or add draft picks, even if your lineup takes a hit this year.' :
      'Fair trades by trade value that make your starting lineup better, ranked by how much they help you and how likely the other manager is to say yes.' + (dynI ? ' Win-now mode still prefers younger players when it\u2019s close.' : '')) +
    (dynI && autoMode ? ' Auto strategy picked ' + (mode === 'contend' ? 'win now' : 'rebuild') + ' because your starters rank ' + ord(me.rank.starter) + ' of ' + m.teams.length + '.' : '');
  return '<section class="head-row"><h2>Trade ideas for ' + teamName(me) + '</h2>' + controls + '</section>' + targetBox +
    (tgt || shop ? '' : blockCard(m)) + '<p class="muted small lead">' + lead + '</p>' +
    (cards ? '<div class="ideas">' + cards + '</div>' : '<section class="card"><p>No fair trades found that improve your lineup' + (opts.team ? ' with this team' : '') + '. Try another team or trade shape, or build one by hand in the calculator.</p></section>') +
    (bl.buy.length || bl.sell.length ? '<div class="grid2 mt"><section class="card"><h3>Buy low</h3><p class="muted small">Values that dropped a lot in the last 30 days, at positions where you need help.</p>' + (bl.buy.map(p => '<div class="row-pl">' + playerLine(p) + '<span class="num">' + fmt(p.value) + '</span><span class="muted small">' + teamName(m.byId.get(p.owner)) + '</span></div>').join('') || '<p class="muted">None right now.</p>') + '</section>' +
      '<section class="card"><h3>Sell high</h3><p class="muted small">Your players whose value jumped in the last 30 days.</p>' + (bl.sell.map(p => '<div class="row-pl">' + playerLine(p) + '<span class="num">' + fmt(p.value) + '</span></div>').join('') || '<p class="muted">None right now.</p>') + '</section></div>' : '');
}
function buyLowSellHigh(m, me) {
  const buy = [], sell = [];
  m.teams.forEach(t => t.players.forEach(p => {
    if (!SKILL.includes(p.pos) || p.value < 1000) return;
    const r = p.trend / p.value;
    if (t.id !== me.id && r <= -0.15 && (me.needs.includes(p.pos) || !me.needs.length)) buy.push(p);
    if (t.id === me.id && r >= 0.15) sell.push(p);
  }));
  return { buy: buy.sort((a, b) => a.trend / a.value - b.trend / b.value).slice(0, 6), sell: sell.sort((a, b) => b.trend / b.value - a.trend / a.value).slice(0, 6) };
}

function viewCalc(m) {
  const c = ui.calc;
  if (c.aTeam == null && m.lg.myTeamId != null) c.aTeam = m.lg.myTeamId;
  const A = c.a.map(id => asset(m, id)).filter(Boolean), B = c.b.map(id => asset(m, id)).filter(Boolean);
  const f = fairness(A, B);
  const tA = m.byId.get(+c.aTeam), tB = m.byId.get(+c.bTeam);
  const side = (key, list, team, label) => {
    const total = list.reduce((s, p) => s + p.value, 0);
    return '<section class="card side"><div class="side-head"><h3>' + label + '</h3>' + teamSelect(key === 'a' ? 'aTeam' : 'bTeam', team ? team.id : null, 'Any team') + '</div>' +
      '<div class="assets">' + (list.map(p => '<div class="asset">' + playerLine(p, { dyn: m.lg.type === 'dynasty' }) + '<span class="num">' + fmt(p.value) + '</span><button class="x" data-act="rm" data-side="' + key + '" data-id="' + esc(p.id) + '" aria-label="Remove ' + esc(p.name) + '">×</button></div>').join('') || '<p class="muted small empty">Add players' + (m.lg.type === 'dynasty' ? ' or picks' : '') + ' below.</p>') + '</div>' +
      '<div class="search"><input id="q-' + key + '" type="search" autocomplete="off" placeholder="Add a player' + (m.lg.type === 'dynasty' ? ' or pick' : '') + '…" data-side="' + key + '" value="' + (ui.search.side === key ? esc(ui.search.q) : '') + '"><div class="results" id="r-' + key + '"></div></div>' +
      ((key === 'a' ? f.adjA : f.adjB) > 0 ? '<div class="waiver-adj"><span>Waiver adjustment</span><b>+' + fmt(key === 'a' ? f.adjA : f.adjB) + '</b></div>' : '') +
      '<div class="side-total"><span>Players ' + fmt(total) + '</span><b>Trade value ' + fmt(key === 'a' ? f.ta : f.tb) + '</b></div></section>';
  };
  let verdict = '', extra = '';
  if (A.length && B.length) {
    const pct = Math.round(f.pct * 100), abs = Math.abs(f.diff);
    const cls = Math.abs(f.pct) < 0.05 ? 'good' : Math.abs(f.pct) < 0.12 ? 'mid' : 'bad';
    const sa = tA ? teamName(tA) : 'Side A', sb = tB ? teamName(tB) : 'Side B';
    const head = Math.abs(f.pct) < 0.05 ? 'Fair trade' : f.diff > 0 ? sa + ' wins by ' + fmt(abs) : sb + ' wins by ' + fmt(abs);
    const share = f.ta + f.tb ? Math.round(f.ta / (f.ta + f.tb) * 100) : 50;
    verdict = '<section class="card verdict ' + cls + '"><div class="v-head">' + head + '<small>' + (Math.abs(pct) < 5 ? 'within 5% either way' : Math.abs(pct) + '% gap in trade value') + '</small></div>' +
      '<div class="split"><div class="split-a" style="width:' + share + '%"><span>' + fmt(f.ta) + '</span></div><div class="split-b"><span>' + fmt(f.tb) + '</span></div></div>' +
      (f.adjA || f.adjB ? '<p class="muted small">Waiver adjustment: the side getting more players has to drop someone to make room, so the side getting fewer is credited with that roster spot, like FantasyCalc does.</p>' : '');
    if (Math.abs(f.pct) >= 0.05) {
      const aShort = f.ta < f.tb;
      const shortSide = aShort ? 'a' : 'b', shortList = aShort ? A : B, longList = aShort ? B : A, shortTeam = aShort ? tA : tB;
      const pool = shortTeam ? shortTeam.players : m.vs.list;
      const ex = new Set(c.a.concat(c.b));
      const bal = balancers(shortList, longList, pool, ex);
      if (bal.length) verdict += '<div class="even"><b>To even it out, ' + (shortTeam ? teamName(shortTeam) : 'the short side') + ' could add:</b>' + bal.map(x => '<button class="chip" data-act="add" data-side="' + shortSide + '" data-id="' + esc(x.p.id) + '">' + esc(x.p.name) + ' · ' + fmt(x.p.value) + '</button>').join('') + '</div>';
    }
    if (tA && tB && tA.id !== tB.id) {
      const pa = A.filter(p => p.owner === tA.id), pb = B.filter(p => p.owner === tB.id);
      const dA = lineup(swapPlayers(tA.players, pa, B.filter(p => SKILL.includes(p.pos))), m.lg.slots).value - tA.starterValue;
      const dB = lineup(swapPlayers(tB.players, pb, A.filter(p => SKILL.includes(p.pos))), m.lg.slots).value - tB.starterValue;
      verdict += '<div class="impact big"><span class="' + (dA >= 0 ? 'pos-d' : 'neg-d') + '">' + teamName(tA) + ' starters ' + sgn(dA) + '</span><span class="' + (dB >= 0 ? 'pos-d' : 'neg-d') + '">' + teamName(tB) + ' starters ' + sgn(dB) + '</span></div>';
    }
    verdict += '<div class="v-actions"><button class="btn" data-act="shareTrade">Share trade</button><button class="btn ghost" data-act="swapSides">Swap sides</button><button class="btn ghost" data-act="clearCalc">Clear</button></div></section>';
  } else if (B.length && tA) {
    const target = f.tb, ex = new Set(c.b);
    const pk = findPackages(tA.players.concat(tA.picks), B.map(p => p.value), m.lg.slots, tA.starterValue, ex);
    extra = '<section class="card verdict"><div class="v-head">Offers from ' + teamName(tA) + '<small>packages worth about ' + fmt(target) + ' that cost your lineup the least</small></div>' +
      (pk.map((x, i) => '<button class="offer" data-act="usePkg" data-i="' + i + '"><span>' + x.give.map(p => esc(p.name)).join(' + ') + '</span><span class="num">' + fmt(x.v) + '</span><span class="muted small">starters ' + sgn(-x.loss) + '</span></button>').join('') || '<p class="muted">No package on this roster matches that value.</p>') + '</section>';
    ui._pkgs = pk;
  } else {
    verdict = '<section class="card verdict"><div class="v-head">Build a trade<small>Add what each side sends. Put players on the right only and the app will suggest what you could offer.</small></div></section>';
  }
  return '<section class="head-row"><h2>Trade calculator</h2><div class="ctrl"><span class="muted small">Values: FantasyCalc ' + esc(m.lg.type) + '</span></div></section>' +
    '<div class="calc">' + side('a', A, tA, tA && tA.id === m.lg.myTeamId ? 'You give' : (tA ? teamName(tA) + ' gives' : 'Side A gives')) + side('b', B, tB, tB ? teamName(tB) + ' gives' : 'Side B gives') + '</div>' + verdict + counterCard(m, A, B, tA, tB) + extra;
}

function standingsCard(m) {
  const po = playoffOdds(m);
  if (!po) return '<section class="card"><h3>Standings</h3><p class="muted small">Standings with playoff odds need your league\u2019s schedule. ' + resyncTip() + '</p></section>';
  const me = m.lg.myTeamId;
  return '<section class="card tablewrap"><div style="padding:16px 16px 0"><h3>Standings and playoff odds</h3><p class="muted small" style="margin:0 0 8px">' + po.spots + ' teams make the playoffs. Odds come from simulating the ' + po.remaining + ' regular-season games left 4,000 times, using each team\u2019s scoring so far and its current lineup.</p></div>' +
    '<table class="league"><thead><tr><th>#</th><th>Team</th><th class="num">W-L</th><th class="num hide-sm">PF/G</th><th>Playoffs</th><th class="num hide-sm">Proj W</th><th class="num hide-sm">#1 seed</th></tr></thead><tbody>' +
    po.rows.map((r, i) => '<tr class="' + (r.t.id === me ? 'me' : '') + (i === po.spots - 1 ? ' cut' : '') + '"><td class="num">' + (i + 1) + '</td><td><div class="tcell">' + fteamAvatar(r.t, 'sm') + '<button class="link" data-act="openTeam" data-id="' + r.t.id + '">' + teamName(r.t) + '</button></div></td>' +
      '<td class="num">' + r.rec.w + '-' + r.rec.l + (r.rec.t ? '-' + r.rec.t : '') + '</td><td class="num hide-sm">' + r.ppg.toFixed(1) + '</td>' +
      '<td><div class="odds"><div class="odds-bar"><i style="width:' + Math.round(r.odds * 100) + '%;background:' + (r.odds >= 0.75 ? 'var(--good)' : r.odds >= 0.25 ? 'var(--mid)' : 'var(--bad)') + '"></i></div><b class="small">' + (r.odds > 0.995 ? '>99' : r.odds < 0.005 ? '<1' : Math.round(r.odds * 100)) + '%</b></div></td>' +
      '<td class="num hide-sm">' + r.projW.toFixed(1) + '</td><td class="num hide-sm">' + Math.round(r.top * 100) + '%</td></tr>').join('') + '</tbody></table></section>';
}

function viewLeague(m) {
  const n = m.teams.length, dynL = m.lg.type === 'dynasty';
  const rows = m.teams.slice().sort((a, b) => a.rank.starter - b.rank.starter).map(t =>
    '<tr class="' + (t.id === m.lg.myTeamId ? 'me' : '') + '"><td class="num">' + t.rank.starter + '</td><td><div class="tcell">' + fteamAvatar(t, 'sm') + '<div><button class="link" data-act="openTeam" data-id="' + t.id + '">' + teamName(t) + '</button><div class="muted small">' + esc(t.owner || '') + '</div></div></div></td>' +
    '<td class="num">' + t.w + '–' + t.l + (t.t ? '–' + t.t : '') + '</td><td class="num">' + fmt(t.starterValue) + '</td><td class="num hide-sm">' + fmt(t.totalValue) + '</td>' + (dynL ? '<td class="num hide-sm">' + fmt(t.pickValue) + '</td>' : '') +
    SKILL.map(p => '<td class="c">' + rankChip(t.rank[p], n) + '</td>').join('') + '</tr>').join('');
  return '<section class="head-row"><h2>' + esc(m.lg.name) + '</h2></section>' + standingsCard(m) + '<h3 class="mt">Power rankings</h3>' +
    '<p class="muted small lead">Ranked by starting-lineup trade value' + (dynL ? '; Roster includes draft picks' : '') + '. Position columns show where each team’s starters rank. Green means top third, red bottom third: red teams are your trade partners for that position.</p>' +
    '<div class="card tablewrap"><table class="league"><thead><tr><th>#</th><th>Team</th><th>Record</th><th>Starters</th><th class="hide-sm">Roster</th>' + (dynL ? '<th class="hide-sm">Picks</th>' : '') + SKILL.map(p => '<th class="c">' + p + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' + managersCard(m);
}

function viewHistory(m) {
  return '<section class="head-row"><h2>History</h2></section><p class="muted small lead">Every trade in ' + esc(m.lg.name) + ' graded by today\u2019s values, your rivalries, and the league\u2019s record book.</p>' + rivalsCard(m) + gradesCard(m) + recordsCard(m);
}

function pwaSteps() {
  return '<section class="card"><h3>Add a league</h3><p class="small">Paste your league\u2019s ESPN link, or just its league ID. The ID is the number after <b>leagueId=</b> in the address when you open your league on espn.com. The league has to be public: your commissioner turns on <b>League Viewable to Public</b> in ESPN\u2019s league settings.</p>' +
    '<div class="row"><input id="pwaId" type="text" inputmode="url" autocomplete="off" placeholder="League link or ID" style="flex:1;min-width:180px"><button class="btn" data-act="pwaAdd">Add and sync</button></div><p id="syncMsg" class="small mt"></p></section>' +
    '<div class="row mt"><button class="btn" data-act="pwaSyncAll">Sync all leagues now</button><span class="muted small">The app also syncs automatically when you open it, if it\u2019s been more than 6 hours.</span></div>';
}
function viewSync() {
  const leagues = S.order.map(id => S.leagues[id]).filter(l => !l.demo);
  if (PWA) return '<section class="head-row"><h2>Your leagues</h2></section>' + pwaSteps() + leaguesCard(leagues);
  return '<section class="head-row"><h2>Sync your ESPN leagues</h2></section>' +
    '<p class="muted small lead">ESPN private leagues only open for logged-in members, so the app syncs through a bookmark that runs on ESPN’s site with your existing login. Your ESPN password and cookies never leave ESPN. Set it up once on a computer, and syncing takes about 10 seconds after that.</p>' +
    '<ol class="steps">' +
    '<li><h3>Add the sync bookmark</h3><p>Show your bookmarks bar (Ctrl+Shift+B on Windows, Cmd+Shift+B on Mac), then drag this button onto it:</p><p><a class="bm" id="bmLink" href="#">⇅ Trade Desk Sync</a></p>' +
    '<details><summary>Can’t drag it?</summary><p>Copy the code below, then right-click the bookmarks bar, choose <b>Add page…</b> (Chrome) or <b>Add Bookmark…</b>, name it “Trade Desk Sync”, and paste the code into the URL field.</p><button class="btn ghost" data-act="copyBm">Copy bookmark code</button> <span id="bmMsg" class="muted small"></span></details></li>' +
    '<li><h3>Open your league on ESPN</h3><p>Go to <a href="https://fantasy.espn.com/football/" target="_blank" rel="noopener">fantasy.espn.com/football</a> while logged in, and open any page of your league (My Team works).</p></li>' +
    '<li><h3>Click the bookmark, then Copy league data</h3><p>A small panel appears on the ESPN page. It pulls your rosters plus current FantasyCalc values matched to your league size and scoring.</p></li>' +
    '<li><h3>Paste it here</h3><textarea id="pasteBox" rows="3" placeholder="Paste the copied league data here"></textarea><div class="row"><button class="btn" data-act="import">Import</button><span id="importMsg" class="small"></span></div></li>' +
    '</ol>' +
    leaguesCard(leagues);
}
function leaguesCard(leagues) {
  return '<section class="card"><h3>Your leagues</h3>' + (leagues.length ? leagues.map(l => {
      const t = l.teams.find(x => x.id === l.myTeamId);
      return '<div class="lrow"><div><b>' + esc(l.name) + '</b><div class="muted small">' + l.teams.length + ' teams · ' + (l.ppr === 1 ? 'PPR' : l.ppr === 0.5 ? 'half-PPR' : 'standard') + ' · synced ' + when(l.syncedAt) + (l.week ? ' (week ' + l.week + ')' : '') + '</div></div>' +
        '<label class="small">Format <select data-act="ltype" data-id="' + esc(l.id) + '"><option value="redraft"' + (l.type === 'redraft' ? ' selected' : '') + '>Redraft</option><option value="dynasty"' + (l.type === 'dynasty' ? ' selected' : '') + '>Dynasty</option></select></label>' +
        (l.type === 'dynasty' ? '<label class="small">Rookie draft rounds <select data-act="lrounds" data-id="' + esc(l.id) + '">' + [1, 2, 3, 4].map(r => '<option value="' + r + '"' + ((l.pickRounds || 3) === r ? ' selected' : '') + '>' + r + '</option>').join('') + '</select></label>' : '') +
        '<label class="small">My team <select data-act="lmine" data-id="' + esc(l.id) + '"><option value="">Choose…</option>' + l.teams.map(x => '<option value="' + x.id + '"' + (x.id === l.myTeamId ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></label>' +
        (PWA ? '<button class="btn ghost" data-act="pwaSync" data-id="' + esc(l.id) + '">Sync</button>' : '') + '<button class="btn ghost danger" data-act="rmLeague" data-id="' + esc(l.id) + '">Remove</button></div>' + (t ? '' : '');
    }).join('') : '<p class="muted">No leagues synced yet. Your redraft and dynasty leagues will both show up here, and you can switch between them at the top.</p>') + '</section>';
}

function picksCard(m, t) {
  const n = m.teams.length;
  const order = draftOrder(m.teams);
  const years = [...new Set(m.picks.map(p => p.year))];
  const owned = t.picks.slice().sort((a, b) => a.year - b.year || a.round - b.round || (a.pickNo || 0) - (b.pickNo || 0));
  const gone = m.picks.filter(p => p.orig === t.id && p.owner !== t.id);
  const ownerSel = p => '<select data-act="pickOwner" data-id="' + esc(p.id) + '" aria-label="Owner of ' + esc(p.name) + '">' + m.teams.map(x => '<option value="' + x.id + '"' + (x.id === p.owner ? ' selected' : '') + '>' + esc(x.abbrev || x.name) + '</option>').join('') + '</select>';
  const row = p => '<tr><td>' + playerLine(p) + '</td><td class="num">' + fmt(p.value) + '</td><td class="c">' + ownerSel(p) + '</td></tr>';
  const myslot = order.findIndex(x => x.id === t.id) + 1;
  return '<section class="card mt"><div class="head-row"><h3>Draft picks · ' + fmt(t.pickValue) + ' value</h3><span class="muted small">' + years[0] + ' projection: pick ' + myslot + ' of ' + n + ' in every round</span></div>' +
    '<p class="muted small">Not a snake: the worst record picks first in every round, so ' + years[0] + ' slots are projected from current standings and update each time you sync. Later years use FantasyCalc’s average value for the round. When you trade a pick, change its owner here.</p>' +
    '<div class="tablewrap"><table class="roster"><tbody>' + (owned.map(row).join('') || '<tr><td class="muted">No picks.</td></tr>') + '</tbody></table></div>' +
    (gone.length ? '<p class="small muted mt">Traded away: ' + gone.map(p => esc(p.name) + ' to ' + teamName(m.byId.get(p.owner))).join(', ') + '</p>' : '') + '</section>';
}

function viewWeekly(m) {
  const me = m.byId.get(m.lg.myTeamId);
  if (!me) return '<section class="card"><h2>Weekly</h2><p>Choose your team first.</p>' + teamSelect('setMine', null, 'Pick your team') + '</section>';
  const dyn = m.lg.type === 'dynasty', n = m.teams.length;
  const resync = '<p class="muted small">Your last sync didn\u2019t include this data. ' + resyncTip() + '</p>';
  // Start / sit
  const ss = startSit(m, me);
  let ssHtml;
  if (!ss) ssHtml = resync;
  else {
    const week = m.lg.week ? 'Week ' + m.lg.week : 'This week';
    ssHtml = '<div class="ss-head"><div><div class="tile-k">' + esc(week) + ' projection, your lineup now</div><div class="tile-v">' + ss.curPts.toFixed(1) + '</div></div><div><div class="tile-k">Best possible</div><div class="tile-v">' + ss.bestPts.toFixed(1) + '</div></div></div>' +
      (ss.gain > 0.05 && ss.ins.length ? '<div class="grid-io"><div><div class="side-k">Put in your lineup</div>' + ss.ins.map(p => '<div class="row-pl">' + playerLine(p) + '<span class="num">' + (p.proj || 0).toFixed(1) + '</span></div>').join('') + '</div>' +
        '<div><div class="side-k">Move to bench</div>' + ss.outs.map(p => '<div class="row-pl">' + playerLine(p) + '<span class="num">' + (p.proj || 0).toFixed(1) + '</span></div>').join('') + '</div></div>' +
        '<p class="pos-d num">+' + ss.gain.toFixed(1) + ' projected points</p>' :
        '<p class="good-t">Your ESPN lineup already matches ESPN\u2019s projections. Nothing to change.</p>') +
      '<p class="muted small">Projections are ESPN\u2019s, from your last sync. Check injury news before kickoff and sync again on game day.</p>';
  }
  // Waivers
  const wv = waiverTargets(m, me);
  const wvHtml = (m.faSource === 'fc' ? '<p class="muted small">Using FantasyCalc players who aren\u2019t on any roster in your league. Reinstall the sync bookmark to pull ESPN\u2019s real free-agent list, including who\u2019s on waivers.</p>' : '') +
    (wv.list.length ? '<table class="roster"><tbody>' + wv.list.map(x => '<tr><td>' + playerLine(x.p, { dyn }) + (x.p.waivers ? '<span class="estb">on waivers</span>' : '') + '</td><td class="num">' + fmt(x.p.value) + '</td><td class="num small ' + (x.gain > 0 ? 'pos-d' : 'muted') + '">' + (x.gain > 0 ? 'starters ' + sgn(x.gain) : dyn ? 'stash' : 'depth') + (x.projGain ? '<br>' + (x.projGain > 0 ? '+' : '') + x.projGain.toFixed(1) + ' pts' : '') + '</td></tr>').join('') + '</tbody></table>' +
      (wv.drop ? '<p class="small muted">Suggested drop: <b>' + esc(wv.drop.name) + '</b> (' + fmt(wv.drop.value) + '), your lowest-value bench player.</p>' : '') : '<p class="muted">No available player beats your bench right now.</p>');
  // Playoff schedule
  const sc = scheduleStrength(m);
  let scHtml;
  if (!sc) scHtml = m.lg.demo ? '<p class="muted small">Shows each starter\u2019s fantasy-playoff opponents once you sync a real league.</p>' : resync;
  else {
    const mine = sc.teams.find(x => x.t.id === me.id);
    const cell = g => !g.opp ? '<td class="c muted">?</td>' : g.opp === 'BYE' ? '<td class="c"><span class="opp bye">BYE</span></td>' : '<td class="c"><span class="opp ' + (g.ease >= 1.08 ? 'easy' : g.ease <= 0.92 ? 'hard' : 'mid') + '" title="' + (g.pa ? g.pa + ' points allowed per game' : '') + '">' + esc(g.opp) + '</span></td>';
    scHtml = '<p class="small">Your starters rank <b>' + ord(mine.rank) + ' of ' + n + '</b> for playoff schedule (weeks ' + sc.weeks.join(', ') + ')' + (mine.byes ? ', with <b class="bad-t">' + mine.byes + ' bye' + (mine.byes > 1 ? 's' : '') + '</b> to plan around' : '') + '. Green is a defense allowing lots of points, red a stingy one.</p>' +
      '<div class="tablewrap"><table class="roster sched"><thead><tr><th></th>' + sc.weeks.map(w => '<th class="c small muted">Wk ' + w + '</th>').join('') + '</tr></thead><tbody>' +
      mine.rows.map(r => '<tr><td>' + playerLine(r.p) + '</td>' + r.g.map(cell).join('') + '</tr>').join('') + '</tbody></table></div>' +
      '<details class="mt"><summary>League playoff schedule ranking</summary><table class="roster"><tbody>' + sc.teams.slice().sort((a, b) => a.rank - b.rank).map(x => '<tr class="' + (x.t.id === me.id ? 'me' : '') + '"><td class="num">' + x.rank + '</td><td>' + teamName(x.t) + '</td><td class="num small">' + (x.ease * 100 - 100 >= 0 ? '+' : '') + Math.round(x.ease * 100 - 100) + '% vs avg</td><td class="small muted">' + (x.byes ? x.byes + ' bye' + (x.byes > 1 ? 's' : '') : '') + '</td></tr>').join('') + '</tbody></table></details>';
  }
  const mu = matchup(m);
  let muHtml = '';
  if (mu && mu.bye) muHtml = '<section class="card"><h3>This week</h3><p>No matchup this week.</p></section>';
  else if (mu) {
    const wp = mu.winP != null ? Math.round(mu.winP * 100) : null;
    const slotRows = (a, b) => {
      const order = SLOT_ORDER;
      const pick = (list, s, used) => { const p = list.find(x => +x.slot === s && !used.has(x.id)); if (p) used.add(p.id); return p; };
      const ua = new Set(), ub = new Set(), rows = [];
      order.forEach(s => { for (let k = 0; k < (+m.lg.slots[s] || 0); k++) { const pa = pick(a, s, ua), pb = pick(b, s, ub); if (pa || pb) rows.push([s, pa, pb]); } });
      return rows.map(([s, pa, pb]) => '<div>' + (pa ? avatar(pa, 'sm') + '<span class="pl-name" data-act="player" data-id="' + esc(pa.id) + '" role="button" tabindex="0">' + esc(pa.name) + '</span><span class="muted">' + (pa.proj != null ? pa.proj.toFixed(1) : '') + '</span>' : '<span class="muted">Empty</span>') + '</div><div class="s">' + esc(SLOT_NAME[s]) + '</div><div class="r">' + (pb ? '<span class="muted">' + (pb.proj != null ? pb.proj.toFixed(1) : '') + '</span><span class="pl-name" data-act="player" data-id="' + esc(pb.id) + '" role="button" tabindex="0">' + esc(pb.name) + '</span>' + avatar(pb, 'sm') : '<span class="muted">Empty</span>') + '</div>').join('');
    };
    muHtml = '<section class="card"><h3>Week ' + (m.lg.week || mu.mp) + ' matchup</h3>' +
      '<div class="mu"><div class="mu-team">' + fteamAvatar(mu.me, 'lg') + '<div class="mu-name">' + teamName(mu.me) + '</div><div class="mu-pts">' + (mu.havePj ? mu.myProj.toFixed(1) : '—') + '</div><div class="small muted">' + mu.me.w + '–' + mu.me.l + (mu.live[0] ? ' · ' + mu.live[0] + ' scored' : '') + '</div></div>' +
      '<div class="mu-vs">VS</div>' +
      '<div class="mu-team">' + fteamAvatar(mu.opp, 'lg') + '<div class="mu-name">' + teamName(mu.opp) + '</div><div class="mu-pts">' + (mu.havePj ? mu.oppProj.toFixed(1) : '—') + '</div><div class="small muted">' + mu.opp.w + '–' + mu.opp.l + (mu.live[1] ? ' · ' + mu.live[1] + ' scored' : '') + '</div></div></div>' +
      (wp != null ? '<div class="wp" role="img" aria-label="Win chance ' + wp + ' percent"><i style="width:' + wp + '%"></i></div><div class="row small" style="justify-content:space-between;margin-top:0"><b>' + wp + '% to win</b><span class="muted">' + (100 - wp) + '%</span></div>' : '<p class="small muted">Projections come with the updated sync bookmark.</p>') +
      (mu.havePj ? '<div class="mu-lines">' + slotRows(mu.myLine, mu.oppLine) + '</div><p class="small muted">Projected points from the lineups set on ESPN at your last sync. Win chance assumes normal week-to-week swings.</p>' : '') + '</section>';
  }
  return '<section class="head-row"><h2>Weekly</h2></section>' + (muHtml ? muHtml + '<div class="mt"></div>' : '') +
    '<div class="grid2"><section class="card"><h3>Start / sit</h3>' + ssHtml + '</section><section class="card"><h3>Waiver pickups</h3><p class="muted small">Best available players compared with your bench' + (dyn ? ', weighted toward younger stashes' : ', ranked by how much they\u2019d help your lineup') + '.</p>' + wvHtml + '</section></div>' +
    '<section class="card mt"><h3>Playoff schedule</h3>' + scHtml + '</section>' + plannerCard(m, me);
}

function managersCard(m) {
  const profs = managerProfiles(m);
  const me = m.byId.get(m.lg.myTeamId);
  const tracked = profs.length && profs[0].tracked;
  const best = profs.filter(x => me && x.t.id !== me.id).sort((a, b) => b.fit - a.fit).slice(0, 3).filter(x => x.fit > 0);
  const dyn = m.lg.type === 'dynasty';
  const posList = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([p, k]) => p + (k > 1 ? ' ×' + k : '')).join(', ') || '—';
  return '<section class="card mt"><h3>Managers</h3>' +
    (best.length ? '<div class="partners"><b>Best trade partners for you:</b><ol>' + best.map(x => '<li><b>' + teamName(x.t) + '</b>: ' + esc(x.reasons.slice(0, 2).join('; ')) + (x.trades ? '; active trader (' + x.trades + ' trade' + (x.trades > 1 ? 's' : '') + ')' : '') + '. <button class="link small" data-act="tradeWith" data-id="' + x.t.id + '">See trades</button></li>').join('') + '</ol></div>' : '') +
    (tracked ? '' : '<p class="muted small">Trade history comes with the updated sync bookmark. ' + resyncTip() + '</p>') +
    '<div class="tablewrap"><table class="league"><thead><tr><th>Team</th>' + (dyn ? '<th>Profile</th>' : '') + '<th class="num">Starter age</th><th>Needs</th><th>Can spare</th>' + (tracked ? '<th class="num">Trades</th><th>Bought</th><th>Sold</th>' : '') + '</tr></thead><tbody>' +
    profs.map(x => '<tr class="' + (me && x.t.id === me.id ? 'me' : '') + '"><td><div class="tcell">' + fteamAvatar(x.t, 'sm') + '<div><button class="link" data-act="openTeam" data-id="' + x.t.id + '">' + teamName(x.t) + '</button>' + (x.history.length ? '<div class="small muted">Last: got ' + esc(x.history[0].got.join(', ') || 'nothing') + ' for ' + esc(x.history[0].sent.join(', ') || 'nothing') + '</div>' : '') + '</div></div></td>' +
      (dyn ? '<td><span class="fair ' + (x.mode === 'contend' ? 'good' : 'mid') + '">' + (x.mode === 'contend' ? 'Contender' : 'Rebuilder') + '</span></td>' : '') +
      '<td class="num">' + (x.age ? x.age.toFixed(1) : '—') + '</td><td>' + (x.t.needs.join(', ') || '—') + '</td><td>' + (x.t.surplus.join(', ') || '—') + '</td>' +
      (tracked ? '<td class="num">' + x.trades + '</td><td class="small">' + esc(posList(x.got)) + '</td><td class="small">' + esc(posList(x.sent)) + '</td>' : '') + '</tr>').join('') +
    '</tbody></table></div></section>';
}

function rookieOrder() {
  const names = ROOKIES.map(r => r[0]);
  if (ui.board !== 'mine' || !Array.isArray(S.rookieBoard)) return ROOKIES;
  const by = new Map(ROOKIES.map(r => [r[0], r]));
  const order = S.rookieBoard.filter(n => by.has(n));
  names.forEach(n => { if (!order.includes(n)) order.push(n); });
  return order.map(n => by.get(n));
}
function viewScout() {
  const act = S.leagues[S.active];
  const lg = act && act.type === 'dynasty' ? act : S.order.map(id => S.leagues[id]).find(l => l.type === 'dynasty');
  const m = lg ? modelFor(lg) : null;
  const n = m ? m.teams.length : 12;
  const rounds = lg ? Math.min(4, +lg.pickRounds || 3) : 3;
  const year = m && m.picks.length ? m.picks[0].year : 2027;
  const nextPicks = m ? m.picks.filter(p => p.year === year) : [];
  const byOverall = new Map(nextPicks.map(p => [(p.round - 1) * n + p.pickNo, p]));
  const mine = m ? m.lg.myTeamId : null;
  const myPicks = nextPicks.filter(p => p.owner === mine).sort((a, b) => a.round - b.round || a.pickNo - b.pickNo);
  const f = ui.scoutPos || '', mineBoard = ui.board === 'mine';
  const list = rookieOrder();
  const consensusRank = new Map(ROOKIES.map((r, i) => [r[0], i + 1]));
  let lastTier = 0;
  const rows = list.map((r, i) => {
    const [name, pos, school, ht, wt, cls, nfl, stats, note] = r;
    const ag = rookieAge(r);
    if (f && pos !== f) return '';
    const k = i + 1, tier = rookieTier(i);
    const pk = byOverall.get(k);
    const label = k <= n * rounds ? Math.ceil(k / n) + '.' + String((k - 1) % n + 1).padStart(2, '0') : 'Undrafted';
    const isMine = pk && pk.owner === mine;
    const own = pk ? m.byId.get(pk.owner) : null;
    const cr = consensusRank.get(name), diff = mineBoard ? cr - k : 0;
    let head = '';
    if (!f && !mineBoard && tier !== lastTier) { head = '<div class="tierh">' + TIER_NAME[tier] + '</div>'; lastTier = tier; }
    return head + '<article class="prospect' + (isMine ? ' me' : '') + '" data-act="prospect" data-name="' + esc(name) + '" role="button" tabindex="0">' +
      '<div class="pr-rank num">' + k + (diff ? '<small class="' + (diff > 0 ? 'pos-d' : 'neg-d') + '">' + (diff > 0 ? '▲' : '▼') + Math.abs(diff) + '</small>' : '') + '</div>' +
      '<div class="pr-main"><div class="pl-main">' + posChip(pos) + '<span class="pl-name">' + esc(name) + '</span></div>' +
      '<div class="pl-meta pr-bio"><span>' + esc(school) + '</span><span>' + esc(ht) + ', ' + wt + ' lbs</span><span>' + esc(cls) + '</span><span class="agechip' + (ag.draft < 21.5 ? ' young' : ag.draft >= 23 ? ' old' : '') + '" title="' + (ag.est ? 'Birth date not published; estimated from class year' : 'Born ' + esc(r[9])) + '">' + (ag.est ? '~' : '') + 'Age ' + ag.now.toFixed(1) + ' · ' + ag.draft.toFixed(1) + ' on draft day' + (ag.est ? ' (est.)' : '') + '</span><span>NFL: ' + esc(nfl) + '</span></div>' +
      '<div class="pr-stats">2026: ' + esc(stats) + '</div><p class="pr-note">' + esc(note) + '</p>' + (() => { const br = boardRanks(name); return br.dyn ? '<div class="small muted">Dynasty boards avg <b class="pos-d">#' + br.dyn.avg.toFixed(1) + '</b>' + (br.nfl ? ' · NFL boards avg <b>#' + br.nfl.avg.toFixed(0) + '</b>' : '') + ' · tap for details</div>' : '<div class="small muted">Tap for details</div>'; })() + '</div>' +
      '<div class="pr-pick"><span class="pk' + (isMine ? ' mine' : '') + '">' + label + '</span>' + (own ? '<div class="small muted pr-own">' + fteamAvatar(own, 'xs') + (isMine ? 'Your pick' : esc(own.abbrev || own.name)) + '</div>' : '') +
      (mineBoard ? '<div class="mv"><button class="mvb" data-act="mv" data-name="' + esc(name) + '" data-d="-1" aria-label="Move ' + esc(name) + ' up">▲</button><button class="mvb" data-act="mv" data-name="' + esc(name) + '" data-d="1" aria-label="Move ' + esc(name) + ' down">▼</button></div>' : '') + '</div></article>';
  }).join('');
  const myTargets = myPicks.map(p => {
    const k = (p.round - 1) * n + p.pickNo, r = list[k - 1];
    const range = list.slice(Math.max(0, k - 3), k + 2).map(x => esc(x[0]) + ' (' + x[1] + ')').join(', ');
    return '<li><b>' + esc(p.name) + '</b> (overall pick ' + k + '): ' + (r ? 'your board says ' + esc(r[0]) + '. Likely range: ' + range : 'past the end of this board') + '</li>';
  }).join('');
  const chips = ['', 'QB', 'RB', 'WR', 'TE'].map(p => '<button class="chip' + (f === p ? ' on' : '') + '" data-act="scoutPos" data-pos="' + p + '">' + (p || 'All') + '</button>').join('');
  const sm = ui.scoutMode || 'board';
  const modeChips = [['board', 'Board'], ['mock', 'Mock draft'], ['live', 'Draft day']].map(([k, l]) => '<button class="chip' + (sm === k ? ' on' : '') + '" data-act="scoutMode" data-mode="' + k + '">' + l + '</button>').join('');
  const boardChips = '<button class="chip' + (!mineBoard ? ' on' : '') + '" data-act="board" data-b="consensus">Consensus</button><button class="chip' + (mineBoard ? ' on' : '') + '" data-act="board" data-b="mine">My board</button>';
  return '<section class="head-row"><h2>' + year + ' rookie scouting</h2><div class="ctrl">' + modeChips + '<span style="width:8px"></span>' + boardChips + '</div></section>' +
    (sm === 'live' ? '<p class="muted small lead">Draft day: tap <b>Draft</b> as each pick comes in. The order comes from the final standings with every traded pick, and suggestions lean toward each team\u2019s needs.' + (ui.board === 'mine' ? ' Your picks follow your board.' : '') + '</p>' : '<p class="muted small lead">' + ROOKIES.length + ' prospects for next spring\u2019s 1QB dynasty draft. Rankings as of ' + ROOKIE_ASOF + (ROOKIE_STATS_ASOF ? '; stats updated ' + when(ROOKIE_STATS_ASOF + 'T12:00:00') : '') + ', with size and 2026 stats from ESPN and ages from Wikipedia birth dates (green = young for the class, which dynasty players prize). Each player is matched to the pick where he\u2019d go in ' + (lg ? esc(lg.name) + '\u2019s' : 'a 12-team') + ' ' + rounds + '-round linear draft, and your picks are highlighted. ' +
    (mineBoard ? 'Use the arrows to build your own board. Arrows next to the rank show how far you moved a player from consensus.' : 'Switch to My board to rank them your way.') + '</p>') +
    (sm === 'live' ? '' : lg ? (myTargets ? '<section class="card"><h3>Your ' + year + ' picks</h3><ul class="why">' + myTargets + '</ul></section>' : (mine == null ? '<section class="card"><p>Pick your team on the Sync tab to see where your picks land.</p></section>' : '')) : '<section class="card"><p>Set one of your leagues to Dynasty on the Sync tab to match this board to your picks.</p></section>') +
    (sm === 'live' ? '' : '<div class="row mt">' + chips + (mineBoard ? '<button class="btn ghost" data-act="resetBoard">Reset to consensus</button>' : '') + '</div>') +
    (sm === 'mock' && m ? '<div class="mt">' + mockCard(m) + '</div>' : sm === 'live' && m ? '<div class="mt">' + liveDraftCard(m) + '</div>' : '<div class="prospects mt">' + rows + '</div>') +
    '<p class="muted small mt">Rankings blend these boards, adjusted for 1QB scoring and 2026 production: ' + ROOKIE_SOURCES.map(s => '<a href="' + s[1] + '" target="_blank" rel="noopener">' + esc(s[0]) + '</a>').join(' · ') + '. Official 40 times come at the NFL Combine in late February. Ask Claude to refresh the board after bowl season and the Combine.</p>';
}

/* ----- main render ----- */
/* Bottom bar has five tabs; Trades and League each hold two views switched from the top of the page. */
/* Outlook only exists for dynasty leagues. */
function subtabGroups() {
  const lg = S && S.leagues && S.leagues[S.active];
  return [[['ideas', 'Trade ideas'], ['calc', 'Calculator']], [['league', 'Standings'], ['history', 'History']].concat(lg && lg.type === 'dynasty' ? [['outlook', 'Outlook']] : [])];
}
function render() {
  ensureLeague();
  renderHeader();
  const m = model();
  if (ui.view === 'outlook' && !(m && m.lg.type === 'dynasty')) ui.view = 'league';
  const v = ui.view;
  let html = '';
  try {
    html = v === 'weekly' ? viewWeekly(m) : v === 'scout' ? viewScout() : v === 'sync' ? viewSync() : v === 'ideas' ? viewIdeas(m) : v === 'calc' ? viewCalc(m) : v === 'league' ? viewLeague(m) : v === 'history' ? viewHistory(m) : v === 'outlook' ? viewOutlook(m) : viewTeam(m);
  } catch (e) { html = '<section class="card"><h2>Something went wrong</h2><p>' + esc(e.message) + '</p><p>Try syncing the league again.</p></section>'; }
  if (v === 'team' && m && (ui.teamView == null || +ui.teamView === m.lg.myTeamId)) { try { html = changesCard(m) + html; } catch (e) {} }
  if (v === 'calc' && ui.sharedNote) { html = '<div class="banner">' + esc(ui.sharedNote) + '</div>' + html; ui.sharedNote = null; }
  const grp = subtabGroups().find(g => g.some(x => x[0] === v));
  if (grp && v !== 'sync') html = '<nav class="subtabs" aria-label="Section views">' + grp.map(([k, label]) => '<a href="#' + k + '" class="' + (k === v ? 'on' : '') + '"' + (k === v ? ' aria-current="page"' : '') + '>' + label + '</a>').join('') + '</nav>' + html;
  $('#view').innerHTML = html;
  if (v === 'sync') { const a = $('#bmLink'); if (a) a.setAttribute('href', BOOKMARKLET); }
  if ((v === 'calc' || (v === 'ideas' && (ui.search.side === 't' || ui.search.side === 's'))) && ui.search.side) { const i = $('#q-' + ui.search.side); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); showResults(ui.search.side, i.value); } }
}

function showResults(side, q) {
  const m = model(), box = $('#r-' + side);
  if (!box) return;
  q = nk(q);
  if (!q) { box.innerHTML = ''; return; }
  if (side === 's') {
    const me = m.byId.get(m.lg.myTeamId);
    const out = me ? me.players.concat(me.picks).filter(p => p.value > 0 && nk(p.name + ' ' + (p.alias || '')).includes(q)).sort((a, b) => b.value - a.value) : [];
    box.innerHTML = out.slice(0, 8).map(p => '<button class="res" data-act="setShop" data-id="' + esc(p.id) + '">' + avatar(p, 'sm') + '<span>' + esc(p.name) + '</span><span class="muted small">' + esc(p.pos) + '</span><span class="num">' + fmt(p.value) + '</span></button>').join('') || '<div class="muted small pad">No players on your roster match</div>';
    return;
  }
  if (side === 't') {
    const out = [];
    m.teams.forEach(t => { if (t.id !== m.lg.myTeamId) t.players.concat(t.picks).forEach(p => { if (p.value > 0 && nk(p.name + ' ' + (p.alias || '')).includes(q)) out.push(p); }); });
    out.sort((a, b) => b.value - a.value);
    box.innerHTML = out.slice(0, 8).map(p => { const own = m.byId.get(p.owner); return '<button class="res" data-act="setTarget" data-id="' + esc(p.id) + '">' + avatar(p, 'sm') + '<span>' + esc(p.name) + '</span><span class="muted small">' + esc(own ? own.abbrev || own.name : '') + '</span><span class="num">' + fmt(p.value) + '</span></button>'; }).join('') || '<div class="muted small pad">No players on other teams match</div>';
    return;
  }
  const c = ui.calc, team = m.byId.get(+(side === 'a' ? c.aTeam : c.bTeam));
  const taken = new Set(c.a.concat(c.b));
  const seen = new Set(), out = [];
  const consider = p => {
    if (seen.has(p.id) || taken.has(p.id) || !(SKILL.includes(p.pos) || p.pos === 'PICK' || p.pos === 'K' || p.pos === 'D/ST') || !nk(p.name + ' ' + (p.alias || '')).includes(q)) return;
    seen.add(p.id); out.push(p);
  };
  if (team) team.players.forEach(consider);
  if (team) team.picks.forEach(consider);
  m.teams.forEach(t => t.players.concat(t.picks).forEach(consider));
  m.vs.list.forEach(p => { if (p.pos === 'PICK' && (m.lg.type !== 'dynasty' || m.picks.length)) return; consider(p); });
  box.innerHTML = out.slice(0, 8).map(p => {
    const own = p.owner != null ? m.byId.get(p.owner) : null;
    return '<button class="res" data-act="add" data-side="' + side + '" data-id="' + esc(p.id) + '">' + avatar(p, 'sm') + '<span>' + esc(p.name) + '</span><span class="muted small">' + (own ? esc(own.abbrev || own.name) : p.pos === 'PICK' ? 'pick' : 'not rostered') + '</span><span class="num">' + fmt(p.value) + '</span></button>';
  }).join('') || '<div class="muted small pad">No matches</div>';
}

/* ----- events ----- */
function route() {
  let h = (location.hash || '').replace('#', '');
  const q = h.match(/^calc\?t=([\w-]+)/);
  if (q) { h = 'calc'; if (openSharedTrade(q[1])) { history.replaceState(null, '', location.pathname + location.search + '#calc'); renderHeader(); } }
  const md = document.getElementById('modal'); if (md) md.hidden = true;
  ui.view = ['team', 'ideas', 'calc', 'weekly', 'league', 'history', 'outlook', 'scout', 'sync'].includes(h) ? h : 'team';
  render();
  window.scrollTo(0, 0);
}
function go(v) { if (location.hash === '#' + v) route(); else location.hash = v; }

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  const act = el.dataset.act, m = model(), c = ui.calc;
  if (act === 'league') { S.active = el.dataset.id; ui.teamView = null; ui.calc = { a: [], b: [], aTeam: null, bTeam: null }; ui.ideaTeam = ''; ui.ideaTarget = null; ui.ideaShop = null; save([]); render(); }
  else if (act === 'add') { const s = el.dataset.side; if (!c[s].includes(el.dataset.id)) c[s].push(el.dataset.id); const p = asset(m, el.dataset.id); const k = s === 'a' ? 'aTeam' : 'bTeam'; if (p && p.owner != null && c[k] == null) c[k] = p.owner; ui.search = { side: null, q: '' }; render(); }
  else if (act === 'rm') { const s = el.dataset.side; c[s] = c[s].filter(x => x !== el.dataset.id); render(); }
  else if (act === 'swapSides') { ui.calc = { a: c.b, b: c.a, aTeam: c.bTeam, bTeam: c.aTeam }; render(); }
  else if (act === 'clearCalc') { ui.calc = { a: [], b: [], aTeam: c.aTeam, bTeam: null }; render(); }
  else if (act === 'openIdea') { const x = ui._ideas[+el.dataset.i]; ui.calc = { a: x.give.map(p => p.id), b: x.get.map(p => p.id), aTeam: m.lg.myTeamId, bTeam: x.team.id }; go('calc'); }
  else if (act === 'usePkg') { const x = ui._pkgs[+el.dataset.i]; c.a = x.give.map(p => p.id); render(); }
  else if (act === 'setTarget') { ui.ideaShop = null; ui.ideaTarget = el.dataset.id; ui.search = { side: null, q: '' }; render(); }
  else if (act === 'clearTarget') { ui.ideaTarget = null; render(); }
  else if (act === 'setShop') { ui.ideaShop = el.dataset.id; ui.ideaTarget = null; ui.search = { side: null, q: '' }; render(); }
  else if (act === 'clearShop') { ui.ideaShop = null; render(); }
  else if (act === 'player') { openPlayer(el.dataset.id); }
  else if (act === 'editVal') { editValue(el.dataset.id); }
  else if (act === 'board') { ui.board = el.dataset.b; if (ui.board === 'mine' && !Array.isArray(S.rookieBoard)) { S.rookieBoard = ROOKIES.map(r => r[0]); save([]); } render(); }
  else if (act === 'resetBoard') { S.rookieBoard = ROOKIES.map(r => r[0]); save([]); render(); }
  else if (act === 'mv') {
    const order = rookieOrder().map(r => r[0]), i = order.indexOf(el.dataset.name), j = i + (+el.dataset.d);
    if (i >= 0 && j >= 0 && j < order.length) { [order[i], order[j]] = [order[j], order[i]]; S.rookieBoard = order; save([]); render(); const b = document.querySelector('[data-act="mv"][data-name="' + CSS.escape(el.dataset.name) + '"][data-d="' + el.dataset.d + '"]'); if (b) b.focus(); }
  }
  else if (act === 'scoutPos') { ui.scoutPos = el.dataset.pos; render(); }
  else if (act === 'tradeWith') { ui.ideaTeam = el.dataset.id; go('ideas'); }
  else if (act === 'openTeam') { ui.teamView = +el.dataset.id; go('team'); }
  else if (act === 'pwaAdd') { const id = parseLeagueId($('#pwaId').value); if (!id) { $('#syncMsg').className = 'small mt bad-t'; $('#syncMsg').textContent = 'That doesn\u2019t look like an ESPN league link or ID.'; } else runSync([id]); }
  else if (act === 'pwaSync') { runSync([el.dataset.id]); }
  else if (act === 'pwaSyncAll') { runSync(S.order.filter(id => !S.leagues[id].demo)); }
  else if (act === 'import') { doImport($('#pasteBox').value); }
  else if (act === 'copyBm') {
    let ok = false;
    try { await navigator.clipboard.writeText(BOOKMARKLET); ok = true; } catch (err) {}
    $('#bmMsg').textContent = ok ? 'Copied. Paste it as the bookmark’s URL.' : 'Your browser blocked copying here. Drag the button instead, or open this page on a computer.';
  }
  else if (act === 'rmLeague') { confirmBox('Remove ' + S.leagues[el.dataset.id].name + ' from the app? You can sync it again any time.', () => { const id = el.dataset.id; delete S.leagues[id]; S.order = S.order.filter(x => x !== id); if (S.active === id) S.active = S.order[0] || null; save([id]); render(); }); }
});
document.addEventListener('change', e => {
  const el = e.target, act = el.dataset && el.dataset.act;
  if (!act) return;
  const lg = S.leagues[S.active], val = el.value;
  if (act === 'setMine') { lg.myTeamId = val ? +val : null; save([lg.id]); render(); }
  else if (act === 'teamView') { ui.teamView = val ? +val : null; render(); }
  else if (act === 'ideaTeam') { ui.ideaTeam = val; render(); }
  else if (act === 'ideaNeed') { ui.ideaNeed = val; render(); }
  else if (act === 'leagueMode') { lg.mode = val; save([lg.id]); render(); }
  else if (act === 'ideaShape') { ui.ideaShape = val; render(); }
  else if (act === 'aTeam' || act === 'bTeam') { ui.calc[act] = val ? +val : null; render(); }
  else if (act === 'pickOwner') {
    const p = model().players.get(el.dataset.id);
    lg.pickOwners = lg.pickOwners || {};
    lg.pickOwners[el.dataset.id] = +val;
    save([lg.id]); render();
  }
  else if (act === 'lrounds') { S.leagues[el.dataset.id].pickRounds = +val; save([el.dataset.id]); render(); }
  else if (act === 'ltype') { S.leagues[el.dataset.id].type = val; save([el.dataset.id]); render(); }
  else if (act === 'lmine') { S.leagues[el.dataset.id].myTeamId = val ? +val : null; save([el.dataset.id]); render(); }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.matches && el.matches('.search input')) { ui.search = { side: el.dataset.side, q: el.value }; showResults(el.dataset.side, el.value); }
});
document.addEventListener('paste', e => {
  if (e.target && e.target.id === 'pasteBox') setTimeout(() => doImport($('#pasteBox').value), 0);
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.pl[data-act="player"]')) { e.preventDefault(); openPlayer(e.target.dataset.id); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.prospect[data-act="prospect"]')) { e.preventDefault(); openProspect(e.target.dataset.name); return; }
  if (e.key === '/' && !(e.target.matches && e.target.matches('input, textarea, select'))) { e.preventDefault(); openSearch(); return; }
  if (e.key === 'Escape' && !$('#modal').hidden) { $('#modal').hidden = true; return; }
  if (e.key === 'Escape' && ui.search.side) { ui.search = { side: null, q: '' }; const r = document.querySelectorAll('.results'); r.forEach(x => x.innerHTML = ''); }
});
function doImport(txt) {
  if (!txt.trim()) return;
  const r = importText(txt);
  if (r.ok) {
    ui.teamView = null; ui.calc = { a: [], b: [], aTeam: null, bTeam: null };
    render();
    const msg = $('#importMsg');
    if (msg) { msg.className = 'small good-t'; msg.textContent = r.msg + (r.needTeam ? ' Pick your team below.' : ''); }
  } else {
    const msg = $('#importMsg');
    if (msg) { msg.className = 'small bad-t'; msg.textContent = r.msg; }
  }
}
function resyncTip() { return PWA ? 'Tap the sync button at the top to load it.' : 'Reinstall the sync bookmark from the Sync tab, then sync again.'; }
function findPlayer(m, id) {
  return m.players.get(id) || (m.freeAgents || []).find(p => p.id === id) || globalPlayer(m, id) || m.vs.byId.get(id) || null;
}
function openPlayer(id) {
  const m = model(), p = findPlayer(m, id), lg = m.lg;
  if (!p) return;
  const dyn = lg.type === 'dynasty', me = lg.myTeamId;
  const own = p.owner != null ? m.byId.get(p.owner) : null;
  const other = m.vs.alt && p.pos !== 'PICK' ? ((p.espn && m.vs.alt.byEspn.get(p.espn)) || m.vs.alt.byKey.get(nk(p.name) + '|' + p.pos)) : null;
  const kv = (k, v) => '<div><span>' + k + '</span><b>' + v + '</b></div>';
  const games = p.pos === 'PICK' ? null : playerSchedule(m, p);
  const d = $('#modal');
  const isPick = p.pos === 'PICK';
  d.innerHTML = '<div class="modal-card sheet" role="dialog" aria-modal="true" aria-labelledby="psh">' +
    '<div class="sheet-head">' + avatar(p, 'lg') + '<div><h3 id="psh">' + esc(p.name) + '</h3><div class="pl-meta">' + posChip(p.pos) + (isPick ? '<span>' + esc(p.team) + '</span>' : teamBadge(p.team)) + (p.age ? '<span>' + p.age.toFixed(1) + ' yrs</span>' : '') + (p.inj ? '<span class="inj">' + esc(p.inj.replace('_', ' ').toLowerCase()) + '</span>' : '') + '</div>' +
    '<div class="small muted">' + (own ? 'On ' + teamName(own) + (own.id === me ? ' (you)' : '') : isPick ? '' : 'Free agent') + (p.waivers ? ' · on waivers' : '') + '</div></div>' +
    '<button class="x sheet-x" id="pClose" aria-label="Close">×</button></div>' +
    '<div class="kv">' + kv(dyn ? 'Dynasty value' : 'Redraft value', fmt(p.value) + (p.est ? '*' : '')) +
    (!isPick ? kv(dyn ? 'Redraft value' : 'Dynasty value', other ? fmt(other.value) : '—') : '') +
    (!isPick ? kv('30-day trend', p.trend ? (p.trend > 0 ? '+' : '') + fmt(p.trend) : '—') : '') +
    (p.proj != null ? kv('Proj this week', p.proj.toFixed(1)) : '') + (p.avg != null ? kv('Season avg', p.avg.toFixed(1)) : '') + (p.owned != null ? kv('Rostered', Math.round(p.owned) + '%') : '') + '</div>' +
    (p.est ? '<p class="small muted">* ' + esc(p.estWhy || '') + '</p>' : '') +
    (p.news ? '<div class="newsbox"><b>News · ' + esc(when(p.news.date)) + '</b><p>' + esc(p.news.note) + '</p>' + (p.newsAdj ? '<span class="small muted">Value adjusted ' + (p.news.factor < 1 ? 'down ' + Math.round((1 - p.news.factor) * 100) + '%' : 'up ' + Math.round((p.news.factor - 1) * 100) + '%') + ' for this.</span>' : '') + '</div>' : '') +
    '<div id="pLive"></div>' +
    (games && games.length ? '<h3 class="mt">Fantasy playoffs</h3><div class="row">' + games.map(g => '<div class="c"><div class="small muted">Wk ' + g.w + '</div>' + (g.opp === 'BYE' ? '<span class="opp bye">BYE</span>' : g.opp ? '<span class="opp ' + (g.ease >= 1.08 ? 'easy' : g.ease <= 0.92 ? 'hard' : 'mid') + '">' + esc(g.opp) + '</span>' : '<span class="muted">?</span>') + '</div>').join('') + '</div>' : '') +
    '<div class="row mt">' +
    (own && own.id !== me ? '<button class="btn" id="pTarget">Build offers for him</button><button class="btn ghost" id="pCalc">Add to calculator</button>' : '') +
    (own && own.id === me ? '<button class="btn" id="pTrade">Find trades for him</button><button class="btn ghost" id="pShop">Add to calculator</button>' : '') +
    (own ? '<button class="btn ghost" id="pBlock">' + (own.id === me ? (blockOf(lg).sell.includes(p.id) ? 'Remove from trade block' : 'Put on trade block') : (blockOf(lg).want.includes(p.id) ? 'Remove from wishlist' : 'Add to wishlist')) + '</button>' : '') +
    (!isPick && m.players.get(p.id) ? '<button class="btn ghost" id="pEdit">Change value</button>' : '') + '</div></div>';
  d.hidden = false;
  const close = () => { d.hidden = true; };
  $('#pClose').onclick = close;
  d.onclick = e => { if (e.target === d) close(); };
  if ($('#pTarget')) $('#pTarget').onclick = () => { close(); ui.ideaTarget = p.id; go('ideas'); };
  if ($('#pCalc')) $('#pCalc').onclick = () => { close(); if (!ui.calc.b.includes(p.id)) ui.calc.b.push(p.id); ui.calc.bTeam = p.owner; go('calc'); };
  if ($('#pTrade')) $('#pTrade').onclick = () => { close(); ui.ideaTarget = null; ui.ideaShop = p.id; go('ideas'); };
  if ($('#pShop')) $('#pShop').onclick = () => { close(); if (!ui.calc.a.includes(p.id)) ui.calc.a.push(p.id); ui.calc.aTeam = p.owner; go('calc'); };
  if ($('#pEdit')) $('#pEdit').onclick = () => editValue(p.id);
  loadLive(p);
  if ($('#pBlock')) $('#pBlock').onclick = () => {
    const b = blockOf(lg), k = own.id === me ? 'sell' : 'want';
    b[k] = b[k].includes(p.id) ? b[k].filter(x => x !== p.id) : b[k].concat(p.id);
    save([lg.id]); close(); render();
  };
  $('#pClose').focus();
}
function editValue(id) {
  const m = model(), p = m.players.get(id), lg = S.leagues[S.active];
  if (!p) return;
  const d = $('#modal');
  const base = p.est === 'manual' ? null : p.value;
  d.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="evh"><h3 id="evh">' + esc(p.name) + '</h3>' +
    '<p class="small muted">' + (p.est ? esc(p.estWhy || '') : 'FantasyCalc ' + esc(lg.type) + ' value: ' + fmt(p.fcValue)) + '</p>' +
    '<label class="small" for="evIn">Value used everywhere in the app</label><input id="evIn" type="number" inputmode="numeric" min="0" step="10" value="' + Math.round(p.value) + '">' +
    '<div class="row"><button class="btn" id="evSave">Save</button>' + (lg.type === 'redraft' ? '<button class="btn ghost" id="evOut">Out for season</button>' : '') + (p.est === 'manual' ? '<button class="btn ghost" id="evReset">Reset</button>' : '') + '<button class="btn ghost" id="evNo">Cancel</button></div></div>';
  d.hidden = false;
  const done = v => {
    lg.valueOverrides = lg.valueOverrides || {};
    if (v == null) delete lg.valueOverrides[id]; else lg.valueOverrides[id] = Math.max(0, Math.round(v));
    d.hidden = true; save([lg.id]); render();
  };
  $('#evIn').focus();
  $('#evSave').onclick = () => { const v = parseFloat($('#evIn').value); if (!isNaN(v)) done(v); };
  $('#evIn').onkeydown = e => { if (e.key === 'Enter') $('#evSave').click(); };
  if ($('#evOut')) $('#evOut').onclick = () => done(Math.max(10, Math.round((p.altValue || p.value || 1000) * 0.01)));
  if ($('#evReset')) $('#evReset').onclick = () => done(null);
  $('#evNo').onclick = () => { d.hidden = true; };
}
let syncing = false;
async function runSync(ids, quiet) {
  if (syncing || !ids.length) return;
  syncing = true;
  try { renderHeader(); } catch (e) {}
  const say = (t, cls) => { const el = $('#syncMsg'); if (el) { el.className = 'small mt ' + (cls || ''); el.textContent = t; } if (quiet || !el) { const b = $('#banner'); if (b) b.innerHTML = t ? '<div class="banner">' + esc(t) + '</div>' : ''; } };
  const done = [];
  try {
    for (const id of ids) {
      const name = (S.leagues[id] || {}).name || 'league ' + id;
      try {
        const payload = await espnSync(id, t => say(name + ': ' + t));
        const r = importText(JSON.stringify(payload));
        if (!r.ok) throw new Error(r.msg);
        done.push(payload.league.name);
      } catch (e) { say(name + ': ' + e.message, 'bad-t'); syncing = false; render(); say(name + ': ' + e.message, 'bad-t'); return; }
    }
    syncing = false;
    render();
    say('Synced ' + done.join(' and ') + '.', 'good-t');
    if (quiet) setTimeout(() => { const b = $('#banner'); if (b && b.textContent.startsWith('Synced')) renderHeader(); }, 4000);
  } finally { syncing = false; }
}
function confirmBox(text, onYes) {
  const d = $('#modal');
  d.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true"><p>' + esc(text) + '</p><div class="row"><button class="btn danger" id="mYes">Remove</button><button class="btn ghost" id="mNo">Cancel</button></div></div>';
  d.hidden = false;
  $('#mYes').onclick = () => { d.hidden = true; onYes(); };
  $('#mNo').onclick = () => { d.hidden = true; };
}

window.addEventListener('hashchange', route);
loadLocal();
/* Keep leagues fresh: sync on open and whenever the app comes back to the screen, if data is over 30 minutes old. */
function autoSync() {
  if (!PWA || syncing) return;
  const stale = S.order.filter(id => !S.leagues[id].demo && Date.now() - (S.leagues[id].syncedAt || 0) > 30 * 60e3);
  if (stale.length) runSync(stale, true);
}
if (PWA) {
  setTimeout(autoSync, 600);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoSync(); else return; renderHeader(); });
  setInterval(() => { if (document.visibilityState === 'visible') renderHeader(); }, 60000);
}
try { S.order.forEach(id => { const l = S.leagues[id]; if (l && !l.demo && !(l.history && l.history.length)) recordHistory(l); }); } catch (e) {}
ensureLeague();
route();
connect();
