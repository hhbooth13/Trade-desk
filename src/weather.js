/* Game-day weather: this week's kickoffs, the forecast at outdoor stadiums (Open-Meteo, no key), and warnings for players in them. */
const WX_VENUE = {
  ARI: [33.53, -112.26], ATL: [33.76, -84.40], BAL: [39.28, -76.62], BUF: [42.77, -78.79], CAR: [35.23, -80.85], CHI: [41.86, -87.62],
  CIN: [39.10, -84.52], CLE: [41.51, -81.70], DAL: [32.75, -97.09], DEN: [39.74, -105.02], DET: [42.34, -83.05], GB: [44.50, -88.06],
  HOU: [29.68, -95.41], IND: [39.76, -86.16], JAX: [30.32, -81.64], KC: [39.05, -94.48], LV: [36.09, -115.18], LAC: [33.95, -118.34],
  LAR: [33.95, -118.34], MIA: [25.96, -80.24], MIN: [44.97, -93.28], NE: [42.09, -71.26], NO: [29.95, -90.08], NYG: [40.81, -74.07],
  NYJ: [40.81, -74.07], PHI: [39.90, -75.17], PIT: [40.45, -80.02], SF: [37.40, -121.97], SEA: [47.60, -122.33], TB: [27.98, -82.50],
  TEN: [36.17, -86.77], WSH: [38.91, -76.86]
};
const WX_TTL = 3 * 3600 * 1000;
let WX = null; // { t, games: { ABBR: { home, opp, kick, indoor, venue, temp, wind, pop, snow } } }

function wxRead() {
  try { const w = JSON.parse(localStorage.getItem('td-wx') || 'null'); return w && w.t && Date.now() - w.t < WX_TTL ? w : null; } catch (e) { return null; }
}

/* Warnings for one team's game, most important first. Domes and roofs are skipped. */
function wxWarn(g) {
  if (!g || g.indoor) return [];
  const out = [];
  if (g.snow) out.push({ k: 'snow', s: 'Snow' });
  else if (g.pop != null && g.pop >= 50) out.push({ k: 'rain', s: 'Rain ' + Math.round(g.pop) + '%' });
  if (g.wind != null && g.wind >= 15) out.push({ k: 'wind', s: 'Wind ' + Math.round(g.wind) + ' mph' });
  if (g.temp != null && Math.round(g.temp) < 50) out.push({ k: 'cold', s: 'Cold ' + Math.round(g.temp) + '°' });
  return out;
}

/* ESPN scoreboard -> one entry per team for this week's game. */
function wxGames(sb) {
  const games = {};
  ((sb && sb.events) || []).forEach(ev => {
    const c = (ev.competitions || [])[0];
    if (!c || !ev.date) return;
    const home = (c.competitors || []).find(x => x.homeAway === 'home'), away = (c.competitors || []).find(x => x.homeAway === 'away');
    if (!home || !away || !home.team || !away.team) return;
    const h = home.team.abbreviation, a = away.team.abbreviation, indoor = !!(c.venue && c.venue.indoor);
    games[h] = { home: true, opp: a, kick: ev.date, indoor, venue: h };
    games[a] = { home: false, opp: h, kick: ev.date, indoor, venue: h };
  });
  return games;
}

/* Hourly forecasts for every outdoor home stadium, in one request. */
async function wxForecast(games) {
  const venues = [...new Set(Object.values(games).filter(g => g.home && !g.indoor && WX_VENUE[g.venue]).map(g => g.venue))];
  if (!venues.length) return {};
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + venues.map(v => WX_VENUE[v][0]).join(',') +
    '&longitude=' + venues.map(v => WX_VENUE[v][1]).join(',') +
    '&hourly=temperature_2m,precipitation_probability,wind_speed_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&forecast_days=7';
  const j = await (await fetch(url)).json();
  const arr = Array.isArray(j) ? j : [j], out = {};
  venues.forEach((v, i) => { out[v] = arr[i] && arr[i].hourly ? arr[i] : null; });
  return out;
}

/* Join each team's kickoff hour (UTC) to the matching forecast hour. */
function wxApply(games, fcs) {
  const out = {};
  Object.keys(games).forEach(k => {
    const g = games[k], f = fcs[g.venue], row = { home: g.home, opp: g.opp, kick: g.kick, indoor: g.indoor, venue: g.venue };
    const i = f && !g.indoor ? f.hourly.time.indexOf(g.kick.slice(0, 13) + ':00') : -1;
    if (i >= 0) {
      const h = f.hourly, code = h.weather_code[i];
      row.temp = h.temperature_2m[i]; row.wind = h.wind_speed_10m[i]; row.pop = h.precipitation_probability[i];
      row.snow = (code >= 71 && code <= 77) || (code >= 85 && code <= 86);
    }
    out[k] = row;
  });
  return out;
}

/* Loads once per 3 hours and caches; failures leave the app working without weather. */
async function wxLoad() {
  const cached = wxRead();
  if (cached) { WX = cached; return true; }
  try {
    const sb = await (await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard')).json();
    const games = wxGames(sb);
    if (!Object.keys(games).length) return false;
    WX = { t: Date.now(), games: wxApply(games, await wxForecast(games)) };
    try { localStorage.setItem('td-wx', JSON.stringify(WX)); } catch (e) {}
    return true;
  } catch (e) { return false; }
}

function wxKick(g) {
  return new Date(g.kick).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/* Small chip on a player row: the worst thing in his team's game. */
function wxChip(abbr) {
  const g = WX && WX.games[abbr], w = wxWarn(g);
  if (!w.length) return '';
  return '<span class="wxb" title="' + esc('Game-day weather: ' + w.map(x => x.s).join(', ') + ', ' + (g.home ? 'home' : 'away') + ' vs ' + g.opp) + '">' + esc(w[0].s) + '</span>';
}

/* Team page card: starters whose game has a weather problem. */
function wxCard(t) {
  if (!WX || !t.lineup) return '';
  const rows = t.lineup.starters.filter(s => s.p).map(s => {
    const g = WX.games[s.p.team], w = wxWarn(g);
    return w.length ? '<tr><td>' + esc(s.p.name) + '</td><td class="small">' + esc((g.home ? 'vs ' : 'at ') + g.opp + ' · ' + wxKick(g)) + '</td><td class="small">' + esc(w.map(x => x.s).join(', ')) + '</td></tr>' : '';
  }).join('');
  return '<section class="card mt"><h3>Game-day weather</h3><p class="muted small">Forecast for this week’s kickoffs. Wind hurts passing and kicking most, and rain or cold affects the ball. Dome and roof games are skipped.</p>' +
    (rows ? '<table class="roster"><tbody>' + rows + '</tbody></table>' : '<p class="small">No weather concerns for your starters this week.</p>') + '</section>';
}
