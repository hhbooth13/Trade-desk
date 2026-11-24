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
  const add = '<button class="btn sm ghost" data-act="tradeAdd">+ Add a trade</button>';
  const head = '<div class="row" style="justify-content:space-between;margin:0 0 6px"><h3 style="margin:0">Trade grades</h3>' + add + '</div>';
  if (!gs.length) return '<section class="card mt">' + head + '<p class="muted small">' + (m.lg.trades ? 'No trades found from ESPN yet. If your league has made trades, add them with the button above.' : resyncTip()) + '</p></section>';
  return '<section class="card mt">' + head + '<p class="muted small">Every trade this season, judged by what each side’s haul is worth today. Missing one? Add it above.</p>' +
    gs.map(g => '<div class="grade"><div class="grade-top"><span class="fair ' + (g.grade === 'Even' ? 'good' : 'mid') + '">' + (g.grade === 'Even' ? 'Even trade' : (g.grade === 'Win' ? 'Clear win: ' : 'Slight edge: ') + esc(g.winner ? g.winner.name : '')) + '</span>' +
      '<span class="small muted">' + (g.pending ? '<span class="estb">in review</span> ' : '') + (g.manual ? 'added by you · ' : '') + (g.d ? when(g.d) : '') + (g.manual ? ' <button class="link small" data-act="tradeDel" data-id="' + esc(g.manual) + '">Remove</button>' : '') + '</span></div>' +
      g.rows.map(r => '<div class="grade-side"><div class="tcell">' + fteamAvatar(r.team, 'sm') + '<b>' + teamName(r.team) + '</b><span class="muted small">got</span></div><div class="grade-got">' + r.got.map(p => '<span class="gchip" data-act="player" data-id="' + esc(p.id) + '">' + esc(p.name) + ' <b>' + fmt(p.value) + '</b></span>').join('') + '</div><div class="num">' + fmt(r.v) + '</div></div>').join('') + '</div>').join('') + '</section>';
}

/* ---------- Add a trade by hand (for trades the ESPN sync misses, or pick trades) ---------- */
function openTradeForm() {
  const m = model(), lg = S.leagues[S.active];
  if (!m) return;
  const st = { a: m.lg.myTeamId || m.teams[0].id, b: (m.teams.find(t => t.id !== (m.lg.myTeamId || m.teams[0].id)) || {}).id, ga: [], gb: [] };
  const d = $('#modal');
  const opts = sel => m.teams.map(t => '<option value="' + t.id + '"' + (t.id === sel ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('');
  const today = new Date().toISOString().slice(0, 10);
  const side = k => '<div class="tf-side"><label class="small muted">Team</label><select id="tf' + k + '" style="width:100%">' + opts(st[k]) + '</select>' +
    '<label class="small muted" style="margin-top:8px;display:block">Got</label><div class="tf-chips" id="tfc' + k + '"></div>' +
    '<input id="tfq' + k + '" type="search" autocomplete="off" placeholder="Add a player' + (m.lg.type === 'dynasty' ? ' or pick' : '') + '" style="width:100%"><div class="gres tf-res" id="tfr' + k + '"></div></div>';
  d.innerHTML = '<div class="modal-card sheet wide" role="dialog" aria-modal="true" aria-labelledby="tfh"><div class="sheet-head"><div><h3 id="tfh">Add a trade</h3><div class="small muted">For trades the ESPN sync missed. Pick the two teams and what each one received.</div></div><button class="x sheet-x" id="pClose" aria-label="Close">×</button></div>' +
    '<div class="tf-grid">' + side('a') + side('b') + '</div>' +
    '<div class="row"><label class="small muted">Date <input id="tfd" type="date" value="' + today + '"></label><span style="flex:1"></span><button class="btn" id="tfSave">Save trade</button></div><p class="small" id="tfMsg"></p></div>';
  d.hidden = false;
  const close = () => { d.hidden = true; };
  $('#pClose').onclick = close;
  d.onclick = e => { if (e.target === d) close(); };
  const pool = () => {
    const { out } = searchPool(m);
    return out.concat(m.picks || []);
  };
  const keyOf = p => p.pos === 'PICK' ? p.id : p.espn && /^\d+$/.test(p.espn) ? +p.espn : /^e\d+$/.test(p.id) ? +p.id.slice(1) : p.id;
  const chips = k => { $('#tfc' + k).innerHTML = st['g' + k].map((p, i) => '<span class="gchip">' + esc(p.name) + ' <b>' + fmt(p.value) + '</b> <button class="link" data-tfrm="' + k + i + '" aria-label="Remove ' + esc(p.name) + '">×</button></span>').join('') || '<span class="muted small">Nothing yet</span>'; };
  const search = k => {
    const q = nk($('#tfq' + k).value), box = $('#tfr' + k);
    if (!q) { box.innerHTML = ''; return; }
    const taken = new Set(st.ga.concat(st.gb).map(p => p.id));
    const hits = pool().filter(p => !taken.has(p.id) && nk(p.name + ' ' + (p.alias || '')).includes(q));
    if (ALLPLAYERS && hits.length < 8) ALLPLAYERS.players.forEach(r => { if (hits.length < 8 && !taken.has('e' + r[0]) && !hits.some(h => h.id === 'e' + r[0]) && nk(r[1]).includes(q)) { const p = globalPlayer(m, r[0]); if (p) hits.push(p); } });
    box.innerHTML = hits.slice(0, 8).map(p => '<button class="gr" data-tfadd="' + k + '" data-id="' + esc(p.id) + '"><span>' + esc(p.name) + ' <span class="muted small">' + esc(p.pos === 'PICK' ? (p.team || '') : p.pos + ' ' + (p.team || '')) + '</span></span><b class="num">' + fmt(p.value) + '</b></button>').join('') || '<p class="muted small">No match.</p>';
    box._hits = hits;
  };
  ['a', 'b'].forEach(k => {
    $('#tf' + k).onchange = e => { st[k] = +e.target.value; };
    $('#tfq' + k).addEventListener('input', () => search(k));
    $('#tfr' + k).addEventListener('click', e => { const b = e.target.closest('[data-tfadd]'); if (!b) return; const p = ($('#tfr' + k)._hits || []).find(x => x.id === b.dataset.id); if (p) { st['g' + k].push(p); chips(k); $('#tfq' + k).value = ''; search(k); $('#tfq' + k).focus(); } });
    $('#tfc' + k).addEventListener('click', e => { const b = e.target.closest('[data-tfrm]'); if (!b) return; st['g' + k].splice(+b.dataset.tfrm.slice(1), 1); chips(k); });
    chips(k);
  });
  $('#tfSave').onclick = () => {
    const msg = $('#tfMsg');
    if (st.a === st.b) { msg.textContent = 'Pick two different teams.'; return; }
    if (!st.ga.length && !st.gb.length) { msg.textContent = 'Add at least one player or pick.'; return; }
    const items = st.ga.map(p => [keyOf(p), st.b, st.a]).concat(st.gb.map(p => [keyOf(p), st.a, st.b]));
    const dv = $('#tfd').value ? new Date($('#tfd').value + 'T12:00:00').getTime() : Date.now();
    lg.manualTrades = (lg.manualTrades || []).concat({ manual: 'mt' + Date.now(), d: dv, items });
    save([lg.id]); close(); render();
  };
  $('#tfqa').focus();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.dataset.act === 'tradeAdd') openTradeForm();
  else if (el.dataset.act === 'tradeDel') { const lg = S.leagues[S.active]; lg.manualTrades = (lg.manualTrades || []).filter(x => x.manual !== el.dataset.id); save([lg.id]); render(); }
});

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
  if (!rec) return '<section class="card mt"><h3>League records</h3><p class="muted small">Records come from your league’s schedule. ' + resyncTip() + '</p></section>';
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

/* ---------- Prospect card ---------- */
function openProspect(name) {
  const r = ROOKIES.find(x => x[0] === name);
  if (!r) return;
  const [nm, pos, school, ht, wt, cls, nfl, stats, note] = r;
  const ag = rookieAge(r), br = boardRanks(nm);
  const cons = ROOKIES.indexOf(r) + 1;
  const mineOrder = Array.isArray(S.rookieBoard) ? S.rookieBoard : null;
  const myRank = mineOrder ? mineOrder.indexOf(nm) + 1 : 0;
  const act = S.leagues[S.active];
  const lg = act && act.type === 'dynasty' ? act : S.order.map(id => S.leagues[id]).find(l => l.type === 'dynasty');
  const m = lg ? modelFor(lg) : null;
  let pickTxt = '—', mockTxt = '—';
  if (m && m.picks.length) {
    const n = m.teams.length, year = m.picks[0].year;
    const byOverall = new Map(m.picks.filter(p => p.year === year).map(p => [(p.round - 1) * n + p.pickNo, p]));
    const pk = byOverall.get(cons);
    pickTxt = pk ? pk.round + '.' + String(pk.pickNo).padStart(2, '0') + ' (' + esc((m.byId.get(pk.owner) || {}).abbrev || '') + ')' : 'After round ' + Math.min(4, +lg.pickRounds || 3);
    const md = mockDraft(m, ROOKIES, ui.board === 'mine' ? rookieOrder() : null, {});
    const hit = md && md.out.find(x => x.r[0] === nm);
    mockTxt = hit ? hit.pick.round + '.' + String(hit.pick.pickNo).padStart(2, '0') + ' to ' + esc(hit.team ? hit.team.abbrev || hit.team.name : '') : 'Undrafted';
  }
  const kv = (k, v) => '<div><span>' + k + '</span><b>' + v + '</b></div>';
  const avgTxt = a => a ? '#' + a.avg.toFixed(1) + ' <small class="muted">(' + a.n + ' of ' + a.of + ' boards)</small>' : 'Not ranked';
  const career = Array.isArray(r.career) && r.career.length ? r.career : null;
  const d = $('#modal');
  d.innerHTML = '<div class="modal-card sheet wide" role="dialog" aria-modal="true" aria-labelledby="prh">' +
    '<div class="sheet-head"><span class="av lg" style="background:var(--' + pos.toLowerCase() + ')" aria-hidden="true">' + esc(initials(nm)) + '</span><div><h3 id="prh">' + esc(nm) + '</h3><div class="pl-meta">' + posChip(pos) + '<span>' + esc(school) + '</span><span>' + esc(cls) + '</span><span>' + esc(ht) + ', ' + wt + ' lbs</span></div>' +
    '<div class="small muted">' + (ag.est ? '~' : '') + 'Age ' + ag.now.toFixed(1) + ' · ' + ag.draft.toFixed(1) + ' on draft day' + (ag.est ? ' (estimated)' : '') + '</div></div><button class="x sheet-x" id="pClose" aria-label="Close">×</button></div>' +
    '<div class="kv">' + kv('Our board', '#' + cons) + (myRank ? kv('Your board', '#' + myRank) : '') + kv('NFL draft', esc(nfl)) + kv('Your league', pickTxt) + kv('Mock draft', mockTxt) + kv('Dynasty boards', avgTxt(br.dyn)) + kv('NFL boards', avgTxt(br.nfl)) + '</div>' +
    '<h3 class="mt">Scouting note</h3><p class="pr-note" style="color:var(--ink)">' + esc(note) + '</p>' +
    '<h3 class="mt">College stats</h3>' + (career ? '<table class="roster"><tbody>' + career.slice().reverse().map(([y, t]) => '<tr><td class="slot">' + y + '</td><td>' + esc(t) + '</td></tr>').join('') + '</tbody></table>' : '<p class="small">' + esc(stats) + ' <span class="muted">(2026)</span></p>') +
    '<h3 class="mt">Big boards</h3><table class="roster boards"><tbody>' + br.rows.map(x => '<tr><td><a href="' + esc(x.b.url) + '" target="_blank" rel="noopener">' + esc(x.b.name) + '</a><div class="small muted">' + (x.b.type === 'nfl' ? 'NFL draft · all positions' : 'Dynasty rookies') + ' · ' + when(x.b.date + 'T12:00:00') + '</div></td><td class="num">' + (x.rank ? '#' + x.rank : '<span class="muted small">not in top ' + x.b.depth + '</span>') + '</td></tr>').join('') + '</tbody></table>' +
    '<p class="small muted">NFL boards rank every position, so their numbers run higher than rookie-only fantasy boards.</p></div>';
  d.hidden = false;
  const close = () => { d.hidden = true; };
  $('#pClose').onclick = close;
  d.onclick = e => { if (e.target === d) close(); };
  $('#pClose').focus();
}

/* ---------- Search any player ---------- */
function globalPlayer(m, id) {
  if (!ALLPLAYERS || !ALLPLAYERS.players) return null;
  const pid = String(id).replace(/^e/, '');
  const row = ALLPLAYERS.players.find(x => String(x[0]) === pid);
  if (!row) return null;
  const [espn, name, posId, pro, owned] = row;
  const pos = POS[posId] || '?';
  const fc = m.vs.byEspn.get(String(espn)) || m.vs.byKey.get(nk(name) + '|' + pos);
  const p = { id: 'e' + espn, espn: String(espn), name, pos, team: (fc && fc.team) || PRO[pro] || 'FA', proTeam: pro, slot: 20, inj: '', value: fc ? fc.value : 0, fcValue: fc ? fc.value : 0, age: fc ? fc.age : null, trend: fc ? fc.trend : 0, owner: null, owned, est: fc ? '' : null };
  if (!fc) { p.est = 'floor'; p.estWhy = 'Not valued by FantasyCalc; deep depth player.'; p.value = pos === 'K' || pos === 'D/ST' ? Math.round(30 + 1.5 * (owned || 0)) : Math.round(10 + (owned || 0) * 4); }
  applyNews([p], NEWS, m.lg.type === 'dynasty' ? 'dynasty' : 'redraft');
  return p;
}
function searchPool(m) {
  const seen = new Set(), out = [];
  const add = p => { if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p); } };
  m.teams.forEach(t => t.players.forEach(add));
  (m.freeAgents || []).forEach(add);
  return { out, seen };
}
function openSearch() {
  const d = $('#modal');
  d.innerHTML = '<div class="modal-card sheet wide search-sheet" role="dialog" aria-modal="true" aria-label="Search players"><div class="row" style="margin:0"><input id="gq" type="search" autocomplete="off" placeholder="Search any NFL player or 2027 prospect" style="flex:1"><button class="x" id="pClose" aria-label="Close">×</button></div><div id="gres" class="gres"></div></div>';
  d.hidden = false;
  const close = () => { d.hidden = true; };
  $('#pClose').onclick = close;
  d.onclick = e => { if (e.target === d) close(); };
  const run = () => {
    const q = nk($('#gq').value), m = model(), box = $('#gres');
    if (!q) { box.innerHTML = '<p class="muted small pad">Every active NFL player' + (ALLPLAYERS ? ' (' + ALLPLAYERS.players.length.toLocaleString('en-US') + ')' : '') + ', plus this year’s rookie prospects.</p>'; return; }
    const pool = searchPool(m), hits = pool.out.filter(p => p.pos !== 'PICK' && nk(p.name).includes(q));
    if (ALLPLAYERS) ALLPLAYERS.players.forEach(r => { if (hits.length < 60 && !pool.seen.has('e' + r[0]) && nk(r[1]).includes(q)) { const p = globalPlayer(m, r[0]); if (p) hits.push(p); } });
    m.vs.list.forEach(x => { if (x.pos !== 'PICK' && !pool.seen.has(x.id) && !hits.some(h => h.id === x.id) && nk(x.name).includes(q)) hits.push(Object.assign({ owner: null }, x)); });
    hits.sort((a, b) => (nk(a.name).startsWith(q) ? 0 : 1) - (nk(b.name).startsWith(q) ? 0 : 1) || b.value - a.value);
    const pros = ROOKIES.filter(r => nk(r[0]).includes(q)).slice(0, 5);
    const status = p => { if (p.owner != null) { const t = m.byId.get(p.owner); return t ? (t.id === m.lg.myTeamId ? '<span class="fair good">Yours</span>' : '<span class="tb" style="background:#4a5160">' + esc(t.abbrev || t.name) + '</span>') : ''; } return '<span class="fair mid">' + (p.waivers ? 'Waivers' : 'Free agent') + '</span>'; };
    box.innerHTML = (hits.slice(0, 25).map(p => '<button class="gr" data-act="gplayer" data-id="' + esc(p.id) + '">' + playerLine(p) + '<span class="gr-r">' + status(p) + '<b class="num">' + fmt(p.value) + '</b></span></button>').join('') +
      (pros.length ? '<div class="tierh">2027 prospects</div>' + pros.map(r => '<button class="gr" data-act="prospect" data-name="' + esc(r[0]) + '"><div class="pl">' + '<span class="av" style="background:var(--' + r[1].toLowerCase() + ')">' + esc(initials(r[0])) + '</span><div class="pl-text"><div class="pl-main"><span class="pl-name">' + esc(r[0]) + '</span></div><div class="pl-meta">' + posChip(r[1]) + '<span>' + esc(r[2]) + '</span></div></div></div><span class="gr-r"><span class="fair good">#' + (ROOKIES.indexOf(r) + 1) + '</span></span></button>').join('') : '')) ||
      '<p class="muted small pad">No players match.</p>';
  };
  $('#gq').addEventListener('input', run);
  run();
  $('#gq').focus();
}

/* ---------- Live ESPN details on player cards (Home Screen app only; the claude.ai page can't reach ESPN) ---------- */
async function loadLive(p) {
  const el = document.getElementById('pLive');
  if (!el || !PWA || !p.espn || !/^\d+$/.test(p.espn) || p.pos === 'D/ST') return;
  el.innerHTML = '<p class="muted small">Loading ESPN stats…</p>';
  const base = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/' + p.espn;
  try {
    const [a, st, gl] = await Promise.all([fetch(base).then(r => r.json()), fetch(base + '/stats').then(r => r.json()).catch(() => ({})), fetch(base + '/gamelog').then(r => r.json()).catch(() => ({}))]);
    const at = a.athlete || a;
    const bio = [at.age ? 'Age ' + at.age : '', at.displayHeight && at.displayWeight ? at.displayHeight + ', ' + at.displayWeight : '', at.displayExperience || '', at.college && at.college.name ? at.college.name : '', at.displayDraft || ''].filter(Boolean).join(' · ');
    const cur = c => { const rows = (c.statistics || []); const last = rows[rows.length - 1]; return last && last.season ? { y: last.season.year, v: Object.fromEntries((c.labels || []).map((l, i) => [l, last.stats[i]])) } : null; };
    const cats = {}; (st.categories || []).forEach(c => { const x = cur(c); if (x) cats[c.name] = x; });
    const parts = [];
    if (cats.passing && +String(cats.passing.v.ATT || 0).replace(/,/g, '') > 0) parts.push(cats.passing.v.YDS + ' pass yds, ' + cats.passing.v.TD + ' TD, ' + cats.passing.v.INT + ' INT');
    if (cats.rushing && +String(cats.rushing.v.CAR || 0).replace(/,/g, '') > 0) parts.push(cats.rushing.v.CAR + ' car, ' + cats.rushing.v.YDS + ' rush yds, ' + cats.rushing.v.TD + ' TD');
    if (cats.receiving && +String(cats.receiving.v.REC || 0).replace(/,/g, '') > 0) parts.push(cats.receiving.v.REC + ' rec (' + (cats.receiving.v.TGTS || '?') + ' tgt), ' + cats.receiving.v.YDS + ' yds, ' + cats.receiving.v.TD + ' TD');
    const gp = (cats.rushing || cats.receiving || cats.passing || {}).v || {};
    const season = (cats.rushing || cats.receiving || cats.passing || {}).y;
    let games = '';
    const reg = (gl.seasonTypes || []).find(s => /Regular/.test(s.displayName)) || (gl.seasonTypes || [])[0];
    const evs = reg && reg.categories && reg.categories[0] ? reg.categories[0].events || [] : [];
    if (evs.length) {
      const labels = gl.labels || [], names = gl.names || [];
      const pick = (row, name) => { const i = names.indexOf(name); return i >= 0 ? row.stats[i] : null; };
      const line = row => {
        const bits = [];
        const pyd = pick(row, 'passingYards'), ptd = pick(row, 'passingTouchdowns'), car = pick(row, 'rushingAttempts'), ryd = pick(row, 'rushingYards'), rtd = pick(row, 'rushingTouchdowns'), rec = pick(row, 'receptions'), cyd = pick(row, 'receivingYards'), ctd = pick(row, 'receivingTouchdowns');
        if (pyd != null && +pyd) bits.push(pyd + ' pass yds' + (+ptd ? ', ' + ptd + ' TD' : ''));
        if (car != null && +car) bits.push(car + '-' + ryd + (+rtd ? ', ' + rtd + ' TD' : ''));
        if (rec != null && +rec) bits.push(rec + ' rec ' + cyd + ' yds' + (+ctd ? ', ' + ctd + ' TD' : ''));
        return bits.join(' · ') || labels.slice(0, 3).map((l, i) => l + ' ' + row.stats[i]).join(' · ');
      };
      games = '<h3 class="mt">Last ' + Math.min(5, evs.length) + ' games</h3><table class="roster"><tbody>' + evs.slice(0, 5).map(row => { const e = (gl.events || {})[row.eventId] || {}; return '<tr><td class="slot">Wk ' + (e.week || '') + '</td><td class="small">' + esc((e.atVs || '') + ' ' + ((e.opponent || {}).abbreviation || '')) + ' <span class="' + (e.gameResult === 'W' ? 'pos-d' : 'neg-d') + '">' + esc((e.gameResult || '') + ' ' + (e.score || '')) + '</span></td><td class="small">' + esc(line(row)) + '</td></tr>'; }).join('') + '</tbody></table>';
    }
    el.innerHTML = (bio ? '<p class="small muted">' + esc(bio) + '</p>' : '') + (parts.length ? '<h3 class="mt">' + (season || '') + ' season' + (gp.GP ? ' · ' + gp.GP + ' games' : '') + '</h3><p class="small">' + parts.map(esc).join('<br>') + '</p>' : '') + games + '<p class="small muted">Live from ESPN.</p>';
  } catch (e) { el.innerHTML = '<p class="muted small">Couldn’t load ESPN stats right now.</p>'; }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.dataset.act === 'prospect') { e.stopPropagation(); openProspect(el.dataset.name); }
  else if (el.dataset.act === 'gplayer') { openPlayer(el.dataset.id); }
  else if (el.dataset.act === 'gsearch') { openSearch(); }
});
