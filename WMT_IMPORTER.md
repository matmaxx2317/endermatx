# WMT Importer — Complete Reference

**Kicktipp group:** Oberislinger WM-Tipprunde  
**App URL:** https://matthiasweigel.com  
**Last import:** FRA-ESP `2026-07-14T21:00:00Z`

---

## Overview

Two import operations happen for each batch of Kicktipp Tippübersicht screenshots:

| Operation | Endpoint | What it does |
|-----------|----------|--------------|
| Tip import | `POST /api/wmt/opponents/import` | Stores each player's predicted score per match |
| Ranking import | `POST /api/wmt/rankings/import` | Stores total points (G) + rank per player per match as graph datapoints |

The ranking graph x-axis is "games played so far" — each snapshot is positioned by how many WMT matches had finished by its `snapshot_time`. Setting a unique `snapshot_time` per match creates one datapoint per game.

**User's explicit request:** "Import every match as a separate datapoint for the graph."

---

## Current State (as of 2026-07-15)

Everything through **FRA-ESP (0:2)** on 2026-07-14 has been imported. Use these as the baseline G values for the next batch:

| Player | G |
|--------|--:|
| Apollo | 251 |
| FoxDevilsWild | 239 |
| stefank | 236 |
| T-Boy | 229 |
| FC_Ahnungslos | 223 |
| Dynamo | 220 |
| Goat | 216 |
| Ballack_Obama | 214 |
| JS | 213 |
| claudeweigel | 210 |
| Tomaldo | 209 |
| Torakelix | 208 |
| MissionSieg2.0 | 206 |
| Mike | 183 |
| 4ponser | 178 |
| Playman2 | 176 |
| Taylor_Swift | 175 |
| BammelBeff | 117 |

> **Verification rule:** The G values you compute for the final match in any batch must exactly match the G column in the Kicktipp screenshot. If they don't, there is either a misread tip, a missed bonus, or a wrong subscript interpretation.

To check the current baseline directly from the API:
```bash
curl -s "https://matthiasweigel.com/api/wmt/rankings" | python3 -c "
import json, sys
from collections import defaultdict
data = json.load(sys.stdin)
by_time = defaultdict(list)
for r in data:
    k = r.get('snapshot_time') or r.get('captured_at','')[:16]
    by_time[k].append(r)
k = sorted(by_time.keys())[-1]
print(f'Last snapshot: {k}')
for r in sorted(by_time[k], key=lambda x: x['rank']):
    print(f'  {r[\"rank\"]:2d}. {r[\"player_name\"]:20s}  G={r[\"points\"]}')"
```

---

## Players

Use the **Full Name (API)** column verbatim in all JSON. The Kicktipp UI truncates long names with "…".

| Full Name (API) | Kicktipp Display | Notes |
|-----------------|-----------------|-------|
| Apollo | Apollo | — |
| FoxDevilsWild | FoxDevils… | — |
| stefank | stefank | — |
| T-Boy | T-Boy | — |
| FC_Ahnungslos | FC_Ahnu… | — |
| Dynamo | Dynamo | — |
| Goat | Goat | — |
| Ballack_Obama | Ballack_O… | — |
| JS | JS | Occasionally skips a match (blank cell) |
| **claudeweigel** | claudewei… | **Our player** — highlighted gold in Kicktipp UI |
| Tomaldo | Tomaldo | — |
| Torakelix | Torakelix | — |
| MissionSieg2.0 | MissionSi… | — |
| Mike | Mike | — |
| 4ponser | 4ponser / 4po… | — |
| Playman2 | Playman2 / Pla… | — |
| Taylor_Swift | Taylor_Sw… | Rarely tips in later rounds; blank = skip |
| **BammelBeff** | BammelBeff | ⚠️ **NEVER tips any match.** Any G increase = pure bonus. Include in ranking snapshots but never in tips import. |

---

## TLA Mappings

Kicktipp uses different short codes for some teams. Apply these when writing `home_tla` / `away_tla` in the tips JSON. All other team codes are identical in both Kicktipp and the DB.

| Kicktipp Header | DB TLA | Country |
|-----------------|--------|---------|
| `SPA` | `ESP` | Spain |
| `CH` | `SUI` | Switzerland |
| `KAN` | `CAN` | Canada |
| `KOL` | `COL` | Colombia |
| `DEU` | `GER` | Germany |
| `NIE` | `NED` | Netherlands |
| `SAFR` | `RSA` | South Africa |

All others (ARG, FRA, ENG, NOR, BEL, MAR, BRA, MEX, USA, POR, PAR, AUS, EGY, GHA, CPV, …) are the same in both.

To verify any TLA: `GET /api/wmt/teams` returns all teams with their TLAs and names.

---

## Scoring System

Kicktipp scores each tip and shows the points earned as a subscript digit in the tip cell. Use the subscript as ground truth when verifying your manual calculation.

| Result | Pts | Subscript | Visual in screenshot | Example |
|--------|----:|-----------|----------------------|---------|
| Exact score match | **4** | ₄ | Colored text with ₄ | Tipped 2:1, result 2:1 |
| Same winner + same GD, different score | **3** | ₃ | Colored text with ₃ | Tipped 1:0, result 2:1 (both GD=1, home win) |
| Same winner, different GD | **2** | ₂ | Colored text with ₂ | Tipped 2:0, result 2:1 (home win, GD=2 vs 1) |
| Wrong winner / wrong tendency | **0** | — | **Grey text, no subscript** | Tipped 2:1, result 0:2 |
| No tip submitted | **0** | — | Empty cell | Do NOT include in tips import |

**Goal difference (GD):** `|home_goals − away_goals|`. Example: result 3:1 → GD=2. Tip 2:0 → GD=2. Same GD, same winner → 3 pts. Tip 1:0 → GD=1. Same winner, different GD → 2 pts.

**Draw scoring (group stage only):** exact=4 pts, any draw tendency=2 pts. In knockout rounds, no player ever tips a draw (Kicktipp doesn't allow it — draws are broken in extra time/penalties).

---

## Screenshot Structure

Each Kicktipp Tippübersicht is captured as **two portrait screenshots** (top/bottom halves) covering all 18 players. Each page shows up to 3 matches.

### Column layout

| Column | Meaning | How to use |
|--------|---------|-----------|
| Pos | Current rank (1–18) | Use as `rank` in rankings import |
| +/− | Rank change vs. previous | Informational only |
| Name | Player name (may be truncated) | Map to full API name |
| [Match columns] | Predicted score with subscript, or grey text, or blank | Parse tip; subscript verifies pts |
| P | Cumulative tip pts for the **entire current stage** | Cross-check only — NOT per visible matches |
| G | Total pts across all tournament matches + all bonuses | Use as `points` in ranking snapshots |

> **Critical:** P is **stage-cumulative**, not page-cumulative. If a page shows 3 of 4 QF matches, P still reflects all 4. Use P only to cross-check stage totals.

### Column headers for matches
Each match column shows two lines: team pair (`NOR / ENG`) and result once finished (`1:2`). Home team is always on top, away team below.

### Special columns
- **S column** (appears in Halbfinale / SF view): Weltmeister Sonderfrage multiplier per player. This is a bonus bet sizing indicator — ignore it. It does not directly feed into your G calculations (bonus points already appear in G when resolved).

### Gesamtübersicht (alternative view)
A separate Kicktipp view shows global standings with columns **B** (total bonus/Sonderfrage points) and **P** (total tip points), where `G = P + B`. Capturing a Gesamtübersicht screenshot is the cleanest way to measure bonus increments — compare the B column before and after a stage to see exactly who got what.

---

## API Endpoints

### POST /api/wmt/opponents/import — Import tips

Imports (or overwrites) predicted scores. Resolves each tip to a match via `home_tla` + `away_tla` (picks the most recent match between that pair).

```json
{
  "tips": [
    {
      "player_name": "Apollo",
      "home_tla": "NOR",
      "away_tla": "ENG",
      "pred_home_goals": 0,
      "pred_away_goals": 1
    }
  ]
}
```

**Rules:**
- `player_name`: exact full API name (not truncated Kicktipp display)
- `home_tla` / `away_tla`: DB TLA (apply mapping table above)
- **Omit** players with blank cells (no tip submitted)
- **Omit** BammelBeff entirely — never tips
- Include grey-text tips (wrong tendency) — import the predicted score, the pts just happen to be 0
- One call per match

**Response:** `{"message": "17 Tipps importiert, 0 übersprungen.", "updated": 17}`

---

### POST /api/wmt/rankings/import — Import ranking snapshots

Imports ranking graph datapoints. Each snapshot is positioned on the x-axis by counting completed WMT matches before its `snapshot_time`.

```json
{
  "snapshots": [
    {
      "date": "2026-07-11",
      "player_name": "Apollo",
      "rank": 1,
      "points": 241,
      "snapshot_time": "2026-07-11T23:00:00Z"
    }
  ]
}
```

**Rules:**
- `date`: calendar date of the match (YYYY-MM-DD)
- `player_name`: full API name
- `rank`: integer 1–18 from the Pos column
- `points`: G column value **at this specific moment** (not final G if this is an intermediate match)
- `snapshot_time`: ISO UTC datetime — set to `[kickoff UTC] + 2h` for match snapshots
- Include **all 18 players** in every snapshot group, including BammelBeff
- A single POST can contain snapshots for multiple matches/bonuses (multiple groups of 18)
- Server upserts by `(date, player_name, snapshot_time)`

**Response:** `{"message": "18 Rangliste-Schnappschüsse importiert, 0 übersprungen.", "updated": 18}`

---

### Other useful endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/wmt/matches` | All matches with teams, results, IDs, kickoff times |
| `GET` | `/api/wmt/teams` | All teams with TLAs — verify TLA spellings |
| `GET` | `/api/wmt/rankings` | All imported ranking snapshots |
| `GET` | `/api/wmt/opponents` | All imported tips (optional `?match_id=` filter) |
| `GET` | `/api/wmt/status` | Quick overview: match counts, stages completed |
| `PUT` | `/api/wmt/matches/{id}/score` | Correct a wrong score. Body: `{"score_home": N, "score_away": M}` |
| `POST` | `/api/wmt/refresh` | Fetch latest match data from football-data.org |

---

### curl templates

```bash
# Import tips for one match
curl -s -X POST "https://matthiasweigel.com/api/wmt/opponents/import" \
  -H "Content-Type: application/json" \
  -d @tips.json

# Import ranking snapshots (can contain multiple matches in one call)
curl -s -X POST "https://matthiasweigel.com/api/wmt/rankings/import" \
  -H "Content-Type: application/json" \
  -d @rankings.json
```

---

## Per-Match Snapshot Strategy

`snapshot_time = [kickoff UTC] + 2 hours` for every match datapoint.

| Situation | snapshot_time to use |
|-----------|---------------------|
| Regular match datapoint | kickoff UTC + 2h (e.g. 21:00Z → 23:00Z) |
| Bonus awarded between two matches | A timestamp between the two matches' snapshot_times |
| Two bonuses at the same stage break | Two different timestamps, e.g. day+0 00:00Z and day+1 12:00Z |
| Daily end-of-day snapshot (no specific match) | Omit `snapshot_time` — server uses `captured_at` |

### Computing intermediate G values

When a batch screenshot shows the final state after N matches but you need individual snapshots:

1. Start from the last known baseline G (from the API or previous import).
2. For match 1: `G₁ = baseline + tip_pts_for_match_1`
3. For match 2: `G₂ = G₁ + tip_pts_for_match_2`
4. Chain forward. The final computed G **must** match the screenshot G column exactly.
5. If it doesn't match: there is a bonus between some of the matches — see Bonus Detection.

---

## Bonus Detection

Kicktipp awards Sonderfrage (bonus question) points for correct predictions of tournament outcomes (group winners, champion pick, top scorer, etc.). These appear as G increases not explained by any tip.

### Detection method

1. **BammelBeff never tips.** Any G increase for BammelBeff = 100% bonus. Use this as your baseline detector.
2. For others: `bonus = actual_G − (baseline_G + sum_of_all_tip_pts)`
3. Players with bonus=0 did not answer that Sonderfrage correctly.
4. Bonuses are usually **+4 per correct Sonderfrage**, awarded to different subsets of players.
5. A player with bonus=+8 received two separate +4 bonuses — create two snapshot groups with different timestamps.

### Bonus snapshot creation

Create one ranking snapshot group per bonus event, with a `snapshot_time` between the preceding match and the following match:

```json
// After ARG-SUI (snapshot: 2026-07-12T03:00Z)
// Before FRA-ESP (kickoff: 2026-07-14T19:00Z)
// Two bonuses detected:

// Bonus 3 snapshot — between matches
{ "date": "2026-07-13", "snapshot_time": "2026-07-13T00:00:00Z", ... }

// Bonus 4 snapshot — day of next match, before kickoff
{ "date": "2026-07-14", "snapshot_time": "2026-07-14T12:00:00Z", ... }
```

### Historical bonus record

| Bonus | Amount | Awarded between | Recipients |
|-------|--------|-----------------|-----------|
| Bonus 1 | +4 | Achtelfinale end → FRA-MAR (QF) | All EXCEPT Mike, 4ponser |
| Bonus 2 | +4 | FRA-MAR → ESP-BEL (QF) | All EXCEPT Apollo, Dynamo, Mike, Playman2, BammelBeff |
| Bonus 3 | +4 | ARG-SUI → FRA-ESP (SF) | All EXCEPT MissionSieg2.0, Mike, Playman2 |
| Bonus 4 | +4 | ARG-SUI → FRA-ESP (SF) | Apollo, stefank, Dynamo, BammelBeff only |

---

## Step-by-Step Workflow

For each new batch of screenshots (typically 2 images = top/bottom halves of 18 players per page):

**1. Identify the matches shown**  
Read the column headers. Each column: team pair on two lines + result below (e.g., `NOR / ENG / 1:2`). Home team is top, away is bottom. Apply TLA mappings.

**2. Get match kickoff times**  
Query `GET /api/wmt/matches`, find each match by home_tla + away_tla. Note the `utc_date` field — add 2h for the snapshot_time.

**3. Parse every tip cell**  
For each player × match cell:
- Colored text with subscript ₂/₃/₄ = 2/3/4 pts
- Grey text, no subscript = 0 pts (wrong tendency)
- Empty cell = no tip (skip in tips import)
- Verify the subscript matches your manual calculation

**4. Compute points earned per tip**  
Use the scoring table. For ₃ (GD match): same winner AND same `|home−away|` but different score. For ₂ (tendency): same winner, different GD. When in doubt, trust the subscript.

**5. Detect bonuses**  
Compute expected G for each player (baseline + all tip pts). Compare to G column in screenshot. Any positive delta = bonus. BammelBeff's delta is always 100% bonus. Standard bonus = +4 per Sonderfrage. Identify which players got each bonus and split into separate events if needed.

**6. Compute intermediate G values**  
Chain: `G_match_N = G_match_(N−1) + tip_pts + bonus_if_applicable`. Final match G must equal screenshot G column exactly.

**7. Build and POST tips JSON**  
One JSON file per match. Skip blank cells and BammelBeff. Use DB TLAs (apply mapping table).

**8. Build rankings JSON**  
One group of 18 per datapoint (match snapshot or bonus snapshot). Sort by G desc for rank (use Pos column from screenshot when available for tiebreakers). Set `snapshot_time = kickoff + 2h`. Add bonus snapshot groups with intermediate timestamps. One POST can contain all groups.

**9. POST and verify**  
Check response counts match expected (e.g. 17 tips = one player had no tip). If counts are off, check for TLA mismatch via `GET /api/wmt/opponents?match_id=N`.

---

## Remaining Matches (as of 2026-07-15)

| Match ID | Home | Away | Kickoff UTC | Stage |
|----------|------|------|-------------|-------|
| 1484 | ENG | ARG | 2026-07-15T19:00:00Z | Halbfinale |
| TBD | FRA (SF loser) | SF loser 2 | ~2026-07-18 | Spiel um Platz 3 |
| TBD | ESP | SF winner | ~2026-07-19 | Finale |

After ENG-ARG finishes, run `GET /api/wmt/matches` and filter for `stage=SEMI_FINALS / THIRD_PLACE / FINAL` to get the assigned match IDs. IDs for 3rd place and Final are auto-assigned once the SFs complete.

### Expect another bonus around the Final

Between the Halbfinale and the Finale, Kicktipp resolves the **Weltmeister Sonderfrage** (tournament winner prediction). This appears as a G jump with no corresponding match. Check BammelBeff's G — any increase after SFs and before Final = bonus. The **S column** seen in Halbfinale view shows each player's Weltmeister bet multiplier, meaning the bonus amounts may vary per player (not a flat +4 for everyone).
