/* ---------- 2027 rookie board (1QB dynasty), as of Nov 23, 2026 ----------
   Order blends TheBigBoard 1QB rookie rankings (Nov 17), Dynasty Nerds Big Board 6.0 (Nov 3),
   Mel Kiper's and PFN's NFL boards, adjusted for 1QB scoring and 2026 production.
   Size, class and 2026 stats come from ESPN's college player pages. Notes are our own summaries. */
const ROOKIE_ASOF = 'Nov 23, 2026';
const ROOKIE_SOURCES = [
  ['TheBigBoard 1QB rookie rankings', 'https://www.thebigboard.gg/dynasty/rookie-rankings-2027'],
  ['Dynasty Nerds Big Board 6.0', 'https://www.dynastynerds.com/nfl-prospect/2027-rookie-big-board-6-0/'],
  ['Mel Kiper 2027 Big Board (ESPN)', 'https://www.espn.com/nfl/draft2027/story/_/id/50182998/2027-nfl-draft-rankings-kiper-big-board-top-prospects'],
  ['PFN 2027 Big Board', 'https://www.profootballnetwork.com/nfl-draft-hq/big-board'],
  ['ESPN college stats', 'https://www.espn.com/college-football/'],
  ['Wikipedia birth dates', 'https://en.wikipedia.org/']
];
/* [name, pos, school, height, weight, class, projected NFL draft, 2026 stats, note, birth date (Wikipedia) or '' if unknown] */
const ROOKIES = [
  ['Jeremiah Smith', 'WR', 'Ohio State', '6\'4"', 222, 'Jr', 'Top 10', '86 rec · 1,482 yds · 17 TD', 'The consensus 1.01 and Ohio State\'s career receiving leader. Many scouts call him the best WR prospect in decades.', '2005-11-29'],
  ['Jadan Baugh', 'RB', 'Florida', '6\'1"', 225, 'Jr', 'Round 1', '197 car · 980 yds · 16 TD', 'Big, physical three-down back and the RB1 on most boards. Huge touchdown production.', ''],
  ['Nate Frazier', 'RB', 'Georgia', '5\'10"', 205, 'Jr', 'Round 1–2', '100 car · 570 yds · 11 TD (5.7 ypc)', 'Explosive with projected sub-4.4 speed. Shares work in Georgia\'s backfield, and catching passes is the question.', '2005-09-26'],
  ['Charlie Becker', 'WR', 'Indiana', '6\'4"', 208, 'Jr', 'Round 1', '59 rec · 1,117 yds · 11 TD', 'The breakout WR of 2026 and the No. 2 receiver on NFL boards. Averages nearly 19 yards a catch.', ''],
  ['Cam Coleman', 'WR', 'Texas', '6\'3"', 204, 'Jr', 'Round 1', '24 rec · 425 yds · 7 TD', 'Elite tools, but low volume in Texas\'s offense this year. Possible buy-low if his rookie-draft price slips.', '2006-08-14'],
  ['KJ Duff', 'WR', 'Rutgers', '6\'6"', 225, 'Jr', 'Round 1–2', '45 rec · 774 yds · 9 TD', 'Huge target with a massive share of Rutgers\' passing game. Rare size for a WR1.', '2005-12-06'],
  ['Ahmad Hardy', 'RB', 'Missouri', '5\'10"', 210, 'Jr', 'Round 2', '13 car · 49 yds (returned Nov 1)', '2025 All-American who led the SEC in rushing. Missed most of 2026 recovering from a gunshot wound to the leg. Elite talent with medical questions.', '2005-12-19'],
  ['Ryan Coleman-Williams', 'WR', 'Alabama', '6\'0"', 184, 'Jr', 'Round 1', '34 rec · 509 yds · 5 TD', 'NFL-ready speed and route running. His 184-lb frame and a quieter 2026 are the knocks.', '2007-02-09'],
  ['Isaac Brown', 'RB', 'Louisville', '5\'9"', 190, 'Jr', 'Round 2', '120 car · 834 yds · 8 TD (7.0 ypc) · 19 rec', 'Big-play back who catches passes. One of the most efficient runners in the class.', '2005-03-02'],
  ['Nick Marsh', 'WR', 'Indiana', '6\'3"', 210, 'Jr', 'Round 1–2', '44 rec · 791 yds · 9 TD', 'Contested-catch specialist opposite Becker. Projects as a big-bodied X receiver.', '2006-10-01'],
  ['Kewan Lacy', 'RB', 'Ole Miss', '5\'11"', 205, 'Jr', 'Round 1–2', '78 car · 388 yds · 5 TD', 'RB1 talent in preseason, but a dislocated shoulder and other injuries limited his 2026. Value pick if healthy.', '2006-07-06'],
  ['Mark Fletcher Jr.', 'RB', 'Miami', '6\'2"', 225, 'Sr', 'Round 2', '131 car · 600 yds · 13 TD', 'Workhorse who ran for 507 yards in Miami\'s 2025 playoff run. Powerful goal-line back.', '2004-10-17'],
  ['Reed Harris', 'WR', 'Arizona State', '6\'5"', 220, 'Sr', 'Round 2', '70 rec · 1,159 yds · 11 TD', 'Came from nowhere to 1,100+ yards. A vertical outside receiver with real size.', ''],
  ['Jamari Johnson', 'TE', 'Oregon', '6\'5"', 255, 'Sr', 'Round 1', '37 rec · 444 yds · 3 TD', 'Top TE on most boards, with first-round athleticism. Oregon\'s QB injury hurt his numbers.', ''],
  ['Trey\'Dez Green', 'TE', 'LSU', '6\'7"', 237, 'Jr', 'Round 1–2', '41 rec · 478 yds · 3 TD', 'Former basketball player and a matchup nightmare. Still raw as a blocker and route runner.', '2006-02-18'],
  ['Jahiem White', 'RB', 'North Texas', '5\'7"', 190, 'Sr', 'Day 3', '204 car · 1,366 yds · 16 TD · 38 rec', 'Among the nation\'s rushing leaders and a real receiver. Size and Day 3 NFL capital are the risks.', '2005-04-19'],
  ['Jamal Roberts', 'RB', 'Missouri', '6\'0"', 216, 'Sr', 'Round 2–3', '251 car · 1,200 yds · 9 TD', 'Carried Missouri while Hardy was out. A proven high-volume back.', '2004-10-26'],
  ['Jackson Harris', 'WR', 'LSU', '6\'2"', 202, 'Jr', 'Round 1–2', '57 rec · 871 yds · 9 TD', 'Kiper\'s No. 5 WR. Long, smooth and productive.', ''],
  ['Drew Mestemaker', 'QB', 'Oklahoma State', '6\'3"', 215, 'So', 'Top 10', '3,533 yds · 30 TD · 11 INT · 4 rush TD', 'Kiper\'s QB1 and a volume passer. In 1QB, QBs slide, so he\'s a value from the late 2nd round on.', ''],
  ['Darian Mensah', 'QB', 'Miami', '6\'3"', 205, 'Jr', 'Round 1', '3,317 yds · 29 TD · 4 INT · 75% comp', 'The most efficient passer in the class. Gives you little as a runner.', '2005-01-25'],
  ['J\'Koby Williams', 'RB', 'Texas Tech', '5\'10"', 185, 'Jr', 'Round 3', '159 car · 1,195 yds · 9 TD (7.5 ypc) · 30 rec', 'Explosive and catches passes. Light frame for a lead back.', ''],
  ['Dylan Riley', 'RB', 'Boise State', '5\'10"', 192, 'Jr', 'Day 2–3', '213 car · 1,360 yds · 11 TD · 25 rec', 'Boise\'s next lead back after Jeanty, with big production and receiving chops.', '2006-06-16'],
  ['DeSean Bishop', 'RB', 'Tennessee', '5\'10"', 215, 'Jr', 'Day 3', '248 car · 1,215 yds · 13 TD', 'Compact, high-volume SEC back. Few catches.', '2004-10-15'],
  ['Mario Craver', 'WR', 'Texas A&M', '5\'9"', 180, 'Jr', 'Round 2', '43 rec · 438 yds · 3 TD', 'Elite speed in a small frame. Gadget and deep-ball weapon.', '2006-01-09'],
  ['Deuce Alexander', 'WR', 'Ole Miss', '6\'0"', 180, 'Jr', 'Round 2–3', '55 rec · 815 yds · 7 TD', 'Became Ole Miss\'s WR1 and has strong chemistry with Chambliss.', '2005-07-27'],
  ['Wyatt Young', 'WR', 'Oklahoma State', '6\'0"', 199, 'Jr', 'Day 3', '56 rec · 835 yds · 8 TD', 'Mestemaker\'s top target. Profiles as a slot receiver.', ''],
  ['Trinidad Chambliss', 'QB', 'Ole Miss', '6\'0"', 205, 'Sr', 'Round 1', '2,853 yds · 24 TD · 9 INT · 7 rush TD', 'Dual-threat production helps in fantasy. Undersized for an NFL QB.', '2002-08-24'],
  ['CJ Carr', 'QB', 'Notre Dame', '6\'2"', 215, 'Jr', 'Round 1', '2,697 yds · 24 TD · 3 INT', 'Kiper\'s QB2 with sharp processing. A limited runner caps his fantasy ceiling.', '2005-05-26'],
  ['Dante Moore', 'QB', 'Oregon', '6\'3"', 220, 'Sr', 'Round 1', '926 yds · 9 TD · 0 INT (4 games)', 'Was a top-pick candidate before a serious concussion on Sept. 26. Out for the season, so watch his medicals.', '2005-05-24'],
  ['LJ Martin', 'RB', 'BYU', '6\'2"', 225, 'Sr', 'Day 3', '82 car · 539 yds · 5 TD (6.6 ypc)', 'Big, efficient back. Missed time with a lower-body injury.', ''],
  ['Hollywood Smothers', 'RB', 'Texas', '5\'11"', 193, 'Sr', 'Round 3', '69 car · 283 yds · 2 TD', 'Speed back in a crowded Texas backfield. His NFL landing spot will matter.', '2005-02-03'],
  ['Wayshawn Parker', 'RB', 'Utah', '5\'10"', 205, 'Jr', 'Day 2–3', '125 car · 765 yds · 9 TD · 29 rec', 'Efficient (6.1 ypc) with a real receiving role. Rising.', ''],
  ['Justice Haynes', 'RB', 'Georgia Tech', '5\'11"', 210, 'Sr', 'Day 3', '148 car · 806 yds · 6 TD', 'Former blue-chip recruit who found a lead role at Georgia Tech.', '2004-10-24'],
  ['Ryan Wingo', 'WR', 'Texas', '6\'2"', 214, 'Jr', 'Round 3', '54 rec · 659 yds · 4 TD', 'Elite athlete still turning traits into production.', '2006-02-15'],
  ['Amare Thomas', 'WR', 'Houston', '6\'0"', 205, 'Sr', 'Round 2–3', '59 rec · 853 yds · 10 TD', 'Top-70 player on PFN\'s board. A reliable touchdown-scoring receiver.', '2005-11-18'],
  ['Arch Manning', 'QB', 'Texas', '6\'4"', 222, 'Sr', 'Round 1', '2,485 yds · 21 TD · 10 INT', 'The biggest name in the class. In 1QB leagues he\'s a third-round luxury.', '2004-04-27'],
  ['Duce Robinson', 'WR', 'Florida State', '6\'6"', 230, 'Sr', 'Round 3', '24 rec · 438 yds · 4 TD (18.3 avg)', 'Former five-star with huge size and big-play ability, but low volume.', '2005-01-19'],
  ['Bryant Wesco Jr.', 'WR', 'Clemson', '6\'2"', 195, 'Jr', 'Round 3', '49 rec · 548 yds · 0 TD', 'Makes plays between the 20s. No touchdowns this year.', '2005-09-22'],
  ['Raleek Brown', 'RB', 'Texas', '5\'9"', 193, 'Sr', 'Day 3', '129 car · 585 yds · 6 TD · 25 rec', 'Ran for 1,141 yards at Arizona State in 2025. Change-of-pace profile.', '2003-08-02'],
  ['Makhi Hughes', 'RB', 'Houston', '6\'0"', 210, 'Sr', 'Day 3', '163 car · 870 yds · 8 TD', 'Was a 1,400-yard back at Tulane, and productive again at Houston.', ''],
  ['Junior Sherrill', 'WR', 'Vanderbilt', '5\'11"', 200, 'Sr', 'Day 2–3', '69 rec · 996 yds · 5 TD', 'Productive all-around receiver who keeps climbing NFL boards.', '2005-06-24'],
  ['Cayden Lee', 'WR', 'Missouri', '5\'11"', 180, 'Sr', 'Day 3', '71 rec · 940 yds · 5 TD', 'High-volume possession receiver.', '2004-11-17'],
  ['Anthony Evans III', 'WR', 'Mississippi State', '5\'11"', 190, 'Sr', 'Day 3', '73 rec · 929 yds · 6 TD', 'Volume slot receiver and returner.', '2005-06-20'],
  ['Julian Sayin', 'QB', 'Ohio State', '6\'1"', 214, 'Jr', 'Round 1', '2,007 yds · 19 TD · 4 INT (10.5 ypa)', 'Accurate pocket passer throwing to Smith. A better NFL prospect than fantasy QB.', '2005-07-22'],
  ['LaNorris Sellers', 'QB', 'South Carolina', '6\'3"', 238, 'Jr', 'Round 2–3', '2,187 yds · 17 TD · 661 rush yds · 7 rush TD', 'The best rushing QB in the class, which matters for fantasy. Passing is inconsistent.', '2005-06-23'],
  ['Austin Simmons', 'QB', 'Missouri', '6\'4"', 220, 'Sr', 'Round 1', '2,693 yds · 25 TD · 4 INT', 'A top-15 player on PFN\'s board with a big arm. Not a runner.', '2005-11-08'],
  ['Isaiah Sategna III', 'WR', 'Oklahoma', '5\'10"', 185, 'Sr', 'Day 3', '56 rec · 722 yds · 5 TD', 'Speedy slot receiver and return man.', '2003-07-11'],
  ['Fluff Bothwell', 'RB', 'Mississippi State', '5\'10"', 230, 'Jr', 'Day 3', '134 car · 649 yds · 3 TD · 20 rec', 'Thick, tackle-breaking back. A sleeper.', ''],
  ['A\'Marion Peterson', 'RB', 'UTSA', '6\'0"', 215, 'Jr', 'Day 3', '83 car · 689 yds · 16 TD (8.3 ypc)', 'Absurd efficiency and touchdown rate. Late-round dart throw.', ''],
  ['Eric Singleton Jr.', 'WR', 'Florida', '5\'10"', 184, 'Sr', 'Round 2–3', '21 rec · 226 yds · 0 TD', 'Speedy flanker whose production dropped in 2026.', '2005-08-28'],
  ['Luke Reynolds', 'TE', 'Virginia Tech', '6\'4"', 250, 'Jr', 'Day 3', '67 rec · 633 yds · 6 TD', 'High-volume receiving TE. Worth a late stash.', ''],
  ['Terrance Carter Jr.', 'TE', 'Texas Tech', '6\'2"', 245, 'Sr', 'Round 3', '30 rec · 318 yds · 5 TD', 'Red-zone producer at TE.', ''],
  ['Jayden Maiava', 'QB', 'USC', '6\'4"', 230, 'Sr', 'Round 2', '3,072 yds · 23 TD · 8 INT', 'Strong tools. Decision-making is the question.', '2003-04-06'],
  ['CJ Baxter', 'RB', 'Kentucky', '6\'1"', 230, 'Sr', 'Day 3', '113 car · 610 yds · 8 TD', 'Big back rebuilding his stock after injuries at Texas.', '2005-06-28'],
  ['Mike Matthews', 'WR', 'Tennessee', '6\'1"', 198, 'Jr', 'Day 3', '39 rec · 608 yds · 4 TD (15.6 avg)', 'Former top recruit producing big plays at Tennessee.', '2005-10-25'],
  ['Ian Strong', 'WR', 'California', '6\'4"', 215, 'Sr', 'Round 3', '41 rec · 531 yds · 2 TD', 'Big outside receiver who\'s rising on NFL boards.', ''],
  ['Nyck Harbor', 'WR', 'South Carolina', '6\'5"', 239, 'Sr', 'Round 3', '25 rec · 418 yds · 3 TD', 'Rare size-speed athlete who\'s still raw.', '2005-07-05'],
  ['Dylan Edwards', 'RB', 'Kansas', '5\'9"', 175, 'Jr', 'Day 3', '141 car · 609 yds · 5 TD · 20 rec', 'Small, shifty, pass-catching back.', '2004-09-22'],
  ['Darius Taylor', 'RB', 'Minnesota', '6\'0"', 215, 'Sr', 'Day 3', '125 car · 403 yds · 6 TD · 32 rec', 'Good receiver, but his efficiency dipped this year.', ''],
  ['Quintrevion Wisner', 'RB', 'Florida State', '6\'0"', 203, 'Sr', 'Day 3', '63 car · 305 yds · 17 rec', 'Former 1,000-yard back at Texas, now in a reduced role.', '2005-05-09'],
  ['Isaiah Augustave', 'RB', 'South Carolina', '6\'0"', 215, 'Jr', 'Day 3', '40 car · 234 yds · 2 TD', 'Athletic backup with upside if he lands well.', ''],
  ['Cameron Dickey', 'RB', 'Texas Tech', '5\'10"', 215, 'Jr', 'Day 3', '83 car · 317 yds · 5 TD', 'Preseason favorite of some analysts. Lost work to J\'Koby Williams.', '2005-11-04']
];
const DRAFT_DAY = new Date('2027-04-22T12:00:00');
const CLASS_DRAFT_AGE = { So: 21.0, Jr: 21.6, Sr: 22.6 };
function rookieAge(r) {
  const dob = r[9];
  if (dob) {
    const b = new Date(dob + 'T12:00:00'), yr = 365.25 * 864e5;
    return { now: (Date.now() - b) / yr, draft: (DRAFT_DAY - b) / yr, est: false };
  }
  const d = CLASS_DRAFT_AGE[r[5]] || 21.8;
  return { now: d - (DRAFT_DAY - Date.now()) / (365.25 * 864e5), draft: d, est: true };
}
/* Fresh size, class and season stats from the daily refresh job (scripts/refresh.py). */
const ROOKIE_LIVE = __ROOKIE_LIVE__;
let ROOKIE_STATS_ASOF = null;
if (ROOKIE_LIVE && ROOKIE_LIVE.players) {
  ROOKIES.forEach(r => {
    const x = ROOKIE_LIVE.players[r[0]];
    if (!x) return;
    if (x.ht) r[3] = x.ht;
    if (x.wt) r[4] = x.wt;
    if (x.cls) r[5] = x.cls;
    if (x.stats) r[7] = x.stats;
    if (x.career) r.career = x.career;
  });
  ROOKIE_STATS_ASOF = ROOKIE_LIVE.asOf;
}
function rookieTier(i) { return i < 1 ? 1 : i < 5 ? 2 : i < 12 ? 3 : i < 24 ? 4 : i < 36 ? 5 : 6; }
const TIER_NAME = { 1: 'Tier 1 · franchise WR', 2: 'Tier 2 · early 1sts', 3: 'Tier 3 · 1st-round values', 4: 'Tier 4 · 1st/2nd turn', 5: 'Tier 5 · 3rd-round targets', 6: 'Tier 6 · late fliers' };
