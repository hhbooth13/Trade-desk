/* ---------- UI for trade grades, counters, trade block, value chart, planner, offseason, mock draft, rivals, records ---------- */
const blockOf = lg => { lg.block = lg.block || { sell: [], want: [] }; return lg.block; };

function blockCard(m) {
  const b = blockOf(m.lg);
  if (!b.sell.length && !b.want.length) return '<p class="muted small lead">Tip: open any player and tap <b>Put on trade block</b> (your players) or <b>Add to wishlist</b> (anyone else). Trade ideas will build around them.</p>';
  const chip = (id, kind) => { const p = m.players.get(id); return p ? '<span class="tchip">' + avatar(p, 'sm') + esc(p.name) + ' <button class="x" data-act="unblock" data-kind="' + kind + '" data-id="' + esc(id) + '" aria-label="Remove ' + esc(p.name) + '">×</button></span>' : ''; };
  return '<div class="card target"><div class="target-row"><b class="small tlabel">Trade block</b><div class="row" style="margin:0">' + (b.sell.map(id => chip(id, 'sell')).join('') || '<span class="muted small">None</span>') + '</div></div>' +
    '<div class="target-row"><b class="small tlabel">Wishlist</b><div class="row" style="margin:0">' + (b.want.map(id => chip(id, 'want')).join('') || '<span class="muted small">None</span>') + '</div></div></div>';
}
function ideasWithBlock(m, opts, base) {
  const b = blockOf(m.lg);
  if (opts.target || opts.shop || (!b.sell.length && !b.want.length)) return base;
  const seen = new Set(base.map(x => x.give.map(p => p.id).join() + '>' + x.get.map(p => p.id).join()));
  const extra = [];
  b.sell.forEach(id => { if (m.players.get(id)) extra.push(...tradeIdeas(m, Object.assign({}, opts, { shop: id, team: null })).slice(0, 3)); });
  b.want.forEach(id => { if (m.players.get(id)) extra.push(...tradeIdeas(m, Object.assign({}, opts, { target: id, team: null })).slice(0, 3)); });
  extra.forEach(x => { const k = x.give.map(p => p.id).join() + '>' + x.get.map(p => p.id).join(); if (!seen.has(k)) { seen.add(k); base.push(x); } });
  return applyBlock(base, b).slice(0, 18);
}

function counterCard(m, A, B, tA, tB) {
  if (!A.length || !B.length || !tA || !tB || tA.id !== m.lg.myTeamId) return '';
  const f = fairness(A, B);
  if (f.pct >= 0.02) return '';
  const cs = counterOffers(m, A, B, tA, tB);
  ui._counters = cs;
  return '<section class="card mt"><h3>Counteroffer</h3><p class="muted small">If ' + teamName(tB) + ' sent you this, here’s how to push it slightly in your favor.</p>' +
    (cs.length ? cs.map((x, i) => '<button class="offer" data-act="useCounter" data-i="' + i + '"><span>' + esc(x.how) + '</span><span class="num ' + (x.f.pct >= 0 ? 'pos-d' : 'neg-d') + '">' + (x.f.pct >= 0 ? '+' : '') + Math.round(x.f.pct * 100) + '%</span><span class="small muted">use</span></button>').join('') :
      '<p class="muted">This offer is too far off to fix with a small change. Start over from your side instead.</p>') + '</section>';
}

function gradesCard(m) {
  const gs = tradeGrades(m);
  if (!gs.length) return '<section class="card mt"><h3>Trade grades</h3><p class="muted small">' + (m.lg.trades ? 'No trades in your league yet this season.' : 'Trade history comes with the updated sync bookmark. Reinstall it from the Sync tab and sync again.') + '</p></section>';
  return '<section class="card mt"><h3>Trade grades</h3><p class="muted small">Every trade this season, judged by what each side’s haul is worth today.</p>' +
    gs.map(g => '<div class="grade"><div class="grade-top"><span class="fair ' + (g.grade === 'Even' ? 'good' : 'mid') + '">' + (g.grade === 'Even' ? 'Even trade' : (g.grade === 'Win' ? 'Clear win: ' : 'Slight edge: ') + esc(g.winner ? g.winner.name : '')) + '</span><span class="small muted">' + (g.d ? when(g.d) : '') + '</span></div>' +
      g.rows.map(r => '<div class="grade-side"><div class="tcell">' + fteamAvatar(r.team, 'sm') + '<b>' + teamName(r.team) + '</b><span class="muted small">got</span></div><div class="grade-got">' + r.got.map(p => '<span class="gchip" data-act="player" data-id="' + esc(p.id) + '">' + esc(p.name) + ' <b>' + fmt(p.value) + '</b></span>').join('') + '</div><div class="num">' + fmt(r.v) + '</div></div>').join('') + '</div>').join('') + '</section>';
}

function valueChart(m, t) {
  const h = (m.lg.history || []).filter(s => s.t && s.t[t.id]);
  if (h.length < 2) return '<section class="card mt"><h3>Value over time</h3><p class="muted small">The app saves your roster’s value every time you sync. After your next sync you’ll see a chart here, and it fills in week by week.</p></section>';
  const W = 640, H = 200, P = 34;
  const tot = h.map(s => s.t[t.id][1]), st = h.map(s => s.t[t.id][0]);
  const lo = Math.min(...st) * 0.95, hi = Math.max(...tot) * 1.03;
  const x = i => P + (W - P * 2) * (h.length === 1 ? 0.5 : i / (h.length - 1)), y = v => H - 24 - (H - 48) * (v - lo) / (hi - lo || 1);
  const line = arr => arr.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const rankNow = m.teams.slice().sort((a, b) => b.totalValue - a.totalValue).findIndex(z => z.id === t.id) + 1;
  const first = h[0].t, firstRank = Object.entries(first).sort((a, b) => b[1][1] - a[1][1]).findIndex(e => +e[0] === t.id) + 1;
  const d = tot[tot.length - 1] - tot[0];
  return '<section class="card mt"><h3>Value over time</h3><p class="small">Roster value is <b class="' + (d >= 0 ? 'pos-d' : 'neg-d') + '">' + (d >= 0 ? 'up ' : 'down ') + fmt(Math.abs(d)) + '</b> since ' + when(h[0].d) + '. League rank: ' + ord(firstRank) + ' → <b>' + ord(rankNow) + '</b>.</p>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Roster value over time">' +
    [0, 0.5, 1].map(k => { const v = lo + (hi - lo) * k; return '<line x1="' + P + '" x2="' + (W - P) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid"/><text x="' + (P - 6) + '" y="' + (y(v) + 4) + '" class="axis" text-anchor="end">' + Math.round(v / 1000) + 'k</text>'; }).join('') +
    '<path d="' + line(tot) + ' L' + x(h.length - 1) + ' ' + (H - 24) + ' L' + x(0) + ' ' + (H - 24) + ' Z" class="area"/>' +
    '<path d="' + line(tot) + '" class="l1"/><path d="' + line(st) + '" class="l2"/>' +
    '<circle cx="' + x(h.length - 1) + '" cy="' + y(tot[tot.length - 1]) + '" r="4.5" class="dot1"/><circle cx="' + x(h.length - 1) + '" cy="' + y(st[st.length - 1]) + '" r="4" class="dot2"/>' +
    '<text x="' + x(0) + '" y="' + (H - 6) + '" class="axis">' + when(h[0].d) + '</text><text x="' + x(h.length - 1) + '" y="' + (H - 6) + '" class="axis" text-anchor="end">' + when(h[h.length - 1].d) + '</text></svg>' +
    '<div class="row small"><span><i class="key k1"></i>Whole roster</span><span><i class="key k2"></i>Starters</span></div></section>';
}

function plannerCard(m, t) {
  const bp = byePlanner(m, t);
  if (!bp) return '<section class="card mt"><h3>Bye week and injury planner</h3><p class="muted small">' + (m.lg.demo ? 'Shows weeks where byes and injuries leave you short, once you sync a real league.' : 'Needs the NFL schedule from the updated sync bookmark. Reinstall it from the Sync tab and sync again.') + '</p></section>';
  const rows = SKILL.filter(p => bp.need[p]).map(p => '<tr><td class="slot">' + p + '</td>' + bp.weeks.map(w => { const s = w.short.find(x => x.pos === p); return '<td class="c"><span class="cell ' + (s ? 'bad' : 'ok') + '">' + w.avail[p] + '/' + bp.need[p] + '</span></td>'; }).join('') + '</tr>').join('') +
    (bp.flex ? '<tr><td class="slot">FLEX</td>' + bp.weeks.map(w => '<td class="c"><span class="cell ' + (w.flexShort ? 'bad' : 'ok') + '">' + (w.flexShort ? '−' + w.flexShort : '✓') + '</span></td>').join('') + '</tr>' : '');
  const problems = bp.weeks.filter(w => w.short.length || w.flexShort || w.missing.length);
  return '<section class="card mt"><h3>Bye week and injury planner</h3><p class="muted small">Healthy players you have at each spot, against how many you start. Red means you’re short and need a pickup or trade.</p>' +
    '<div class="tablewrap"><table class="roster planner"><thead><tr><th></th>' + bp.weeks.map(w => '<th class="c small ' + (w.playoff ? 'po' : 'muted') + '">' + (w.playoff ? 'PO ' : 'Wk ') + w.w + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
    (problems.length ? '<ul class="why mt">' + problems.slice(0, 5).map(w => '<li><b>Week ' + w.w + ':</b> ' + (w.missing.length ? w.missing.map(x => esc(x.p.name) + ' (' + (x.why === 'bye' ? 'bye' : x.why === 'ir' ? 'IR' : 'injured') + ')').join(', ') + ' out' : '') + (w.short.length ? (w.missing.length ? '; ' : '') + 'short at ' + w.short.map(s => s.pos).join(', ') : '') + '</li>').join('') + '</ul>' : '<p class="good-t small">No bye or injury holes the rest of the way.</p>') + '</section>';
}

function offseasonCard(m, t) {
  if (m.lg.type !== 'dynasty') return '';
  const op = offseasonPlan(m, t);
  const col = (title, cls, list, empty) => '<div><div class="side-k">' + title + '</div>' + (list.length ? list.map(x => '<div class="row-pl">' + playerLine(x.p, { dyn: true }) + '<span class="num">' + fmt(x.p.value) + '</span><span class="small ' + cls + '">' + esc(x.why) + '</span></div>').join('') : '<p class="muted small">' + empty + '</p>') + '</div>';
  return '<section class="card mt"><h3>Offseason plan</h3><p class="muted small">Who to build around, who to sell while their value holds, and who’s safe to drop.</p><div class="grid3">' +
    col('Hold', 'pos-d', op.hold, 'No clear core yet.') + col('Sell', 'neg-d', op.sell, 'Nobody aging out of value.') + col('Cut', 'muted', op.cut, 'No obvious drops.') + '</div></section>';
}

function mockCard(m) {
  ui.mockSeed = ui.mockSeed || 0;
  const mine = ui.board === 'mine' ? rookieOrder() : null;
  const md = mockDraft(m, ROOKIES, mine, { random: ui.mockSeed > 0, seed: 7 + ui.mockSeed * 101 });
  if (!md) return '<section class="card"><p>Set a league to Dynasty on the Sync tab to run a mock draft.</p></section>';
  const n = m.teams.length;
  let round = 0;
  return '<section class="card"><div class="head-row" style="margin-bottom:8px"><h3 style="margin:0">' + md.year + ' mock draft</h3><div class="ctrl"><button class="btn ghost" data-act="mockRerun">' + (ui.mockSeed ? 'Run again' : 'Add surprises') + '</button>' + (ui.mockSeed ? '<button class="btn ghost" data-act="mockReset">Straight board</button>' : '') + '</div></div>' +
    '<p class="muted small">Order from current standings (worst picks first every round), traded picks included. Other teams take the best player left on the consensus board, leaning toward their needs. Your picks follow ' + (mine ? 'your board' : 'the consensus board') + '.</p>' +
    md.out.map(x => { const head = x.pick.round !== round ? '<div class="tierh">Round ' + (round = x.pick.round) + '</div>' : ''; return head + '<div class="mock' + (x.mine ? ' me' : '') + '"><span class="pk' + (x.mine ? ' mine' : '') + '">' + x.pick.round + '.' + String(x.pick.pickNo).padStart(2, '0') + '</span>' + fteamAvatar(x.team, 'sm') + '<span class="mock-team">' + esc(x.team ? x.team.abbrev || x.team.name : '') + '</span>' + posChip(x.r[1]) + '<b class="mock-name">' + esc(x.r[0]) + '</b><span class="muted small">' + esc(x.r[2]) + '</span>' + (Math.abs(x.reach) >= 4 ? '<span class="small ' + (x.reach > 0 ? 'neg-d' : 'pos-d') + '">' + (x.reach > 0 ? 'reach' : 'value') + '</span>' : '') + '</div>'; }).join('') + '</section>';
}

function rivalsCard(m) {
  const rivals = m.lg.rivals || [];
  const me = m.lg.myTeamId;
  const ch = rivalChanges(m, m.lg.prev);
  const list = m.teams.filter(t => rivals.includes(t.id));
  const follow = '<div class="row">' + m.teams.filter(t => t.id !== me).map(t => '<button class="chip' + (rivals.includes(t.id) ? ' on' : '') + '" data-act="rival" data-id="' + t.id + '">' + esc(t.abbrev || t.name) + '</button>').join('') + '</div>';
  const body = !list.length ? '<p class="muted small">Tap teams above to follow them.</p>' : list.map(t => {
    const c = ch ? ch.find(x => x.t.id === t.id) : null;
    return '<div class="rival"><div class="tcell">' + fteamAvatar(t) + '<div><b>' + teamName(t) + '</b><div class="small muted">' + t.w + '–' + t.l + ' · starters ' + ord(t.rank.starter) + ' · roster ' + ord(t.rank.total) + (c && c.dTotal != null ? ' · value <span class="' + (c.dTotal >= 0 ? 'pos-d' : 'neg-d') + '">' + sgn(c.dTotal) + '</span> since last sync' : '') + '</div></div></div>' +
      (c ? ((c.added.length || c.dropped.length) ? '<div class="small mt">' + (c.added.length ? '<div><b class="pos-d">Added:</b> ' + c.added.map(p => '<span class="gchip" data-act="player" data-id="' + esc(p.id) + '">' + esc(p.name) + '</span>').join(' ') + '</div>' : '') + (c.dropped.length ? '<div><b class="neg-d">Dropped:</b> ' + c.dropped.map(p => esc(p.name)).join(', ') + '</div>' : '') + '</div>' : '<p class="small muted">No roster moves since your last sync.</p>') : '<p class="small muted">Roster moves show up starting with your next sync.</p>') + '</div>';
  }).join('');
  return '<section class="card mt"><h3>Rivals</h3>' + follow + body + '</section>';
}

function recordsCard(m) {
  const rec = leagueRecords(m);
  if (!rec) return '<section class="card mt"><h3>League records</h3><p class="muted small">Records come from your league’s schedule. Reinstall the sync bookmark and sync again.</p></section>';
  return '<section class="card mt"><h3>League records</h3><div class="records">' + rec.map(r => '<div class="recd"><span class="tile-k">' + esc(r.k) + '</span><b class="tile-v">' + esc(r.v) + '</b><div class="tcell small">' + fteamAvatar(r.who, 'sm') + '<span><b>' + teamName(r.who) + '</b><br><span class="muted">' + esc(r.note) + '</span></span></div></div>').join('') + '</div></section>';
}

/* Snapshots: history for the chart and the previous rosters for the rival tracker. */
function recordHistory(lg) {
  const m = modelFor(lg);
  if (!m) return;
  lg.history = (lg.history || []).filter(s => s && s.t);
  const snap = snapshot(m), last = lg.history[lg.history.length - 1];
  if (last && Math.abs(last.d - snap.d) < 3 * 3600e3) lg.history[lg.history.length - 1] = snap; else lg.history.push(snap);
  if (lg.history.length > 80) lg.history = lg.history.slice(-80);
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, lg = S.leagues[S.active];
  if (act === 'unblock') { const b = blockOf(lg); b[el.dataset.kind] = b[el.dataset.kind].filter(x => x !== el.dataset.id); save([lg.id]); render(); }
  else if (act === 'useCounter') { const x = ui._counters[+el.dataset.i]; ui.calc.a = x.give.map(p => p.id); ui.calc.b = x.get.map(p => p.id); render(); }
  else if (act === 'mockRerun') { ui.mockSeed = (ui.mockSeed || 0) + 1; render(); }
  else if (act === 'mockReset') { ui.mockSeed = 0; render(); }
  else if (act === 'scoutMode') { ui.scoutMode = el.dataset.mode; render(); }
  else if (act === 'rival') { const id = +el.dataset.id; lg.rivals = lg.rivals || []; lg.rivals = lg.rivals.includes(id) ? lg.rivals.filter(x => x !== id) : lg.rivals.concat(id); save([lg.id]); render(); }
});
