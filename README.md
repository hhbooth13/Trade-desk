# Trade Desk

A fantasy football app for ESPN leagues: trade calculator and trade ideas built on FantasyCalc values, weekly matchup and start/sit help, waivers, playoff odds, league history, and a 2027 rookie scouting board with a mock draft.

**Open it:** https://hhbooth13.github.io/Trade-desk/

## Put it on your iPhone

1. Open the link above in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open Trade Desk from its icon. It runs full screen like any other app.

## Sync your leagues

On the **Sync** screen (the **Sync league** button at the top), paste your league's ESPN link or league ID. Leagues must be public: the commissioner turns on **League Viewable to Public** in ESPN league settings. After that, one tap syncs rosters, schedules and fresh FantasyCalc values, and the app refreshes itself when you open it if it's been more than 6 hours.

Your data stays on your phone (browser storage for this site).

## Files

- `index.html`: the whole app, one file
- `manifest.json`, `icon-*.png`: Home Screen icon and full-screen settings
- `sw.js`: lets the app open offline with the last synced data

## How it stays up to date

- **Every time you open it:** the app re-syncs your leagues (rosters, injuries, projections, schedule) and FantasyCalc values if they're more than 6 hours old.
- **Every morning (`.github/workflows/daily-refresh.yml`):** GitHub pulls fresh FantasyCalc values and every scouting prospect's stats, size and class from ESPN (`scripts/refresh.py`), rebuilds the app and publishes it.
- **News adjustments (`src/news.json`):** real-world news that FantasyCalc hasn't caught up to yet (injuries, lost jobs, trades). Each item nudges a player's value up or down and shows a "news" note in the app until its expiry date.

To change the app, edit files in `src/` and run `python3 src/build.py`.
