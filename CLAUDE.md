# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A collection of browser-based personal tools — productivity apps, personal trackers, and games — served as a React SPA backed by a FastAPI + PostgreSQL API, deployed on Railway.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite, `react-router-dom` v6 |
| Backend | FastAPI + uvicorn |
| Database | PostgreSQL (Railway managed) |
| Hosting | Railway (single service: FastAPI serves the built Vite SPA) |
| Font | Inter via Google Fonts |

**No external state management, no ORM migrations tool — SQLAlchemy creates tables via `Base.metadata.create_all` on startup.**

## Deployment

Push to `main` → Railway rebuilds and redeploys automatically.

Build command (in `railway.toml`):
```
pip install -r backend/requirements.txt && npm --prefix frontend install && npm --prefix frontend run build
```
Start command:
```
uvicorn backend.main:app --host 0.0.0.0 --port $PORT
```

FastAPI serves the Vite-built `frontend/dist/` as a SPA with a catch-all `/{full_path:path}` route. Legacy static games are mounted separately at `/games`.

The home page calls `/api/info` to show the Railway deploy URL and server start time.

## Development workflow

Every piece of work follows this cycle — never deviate from it:

1. **New branch** — create a new feature branch for the work (`git checkout -b <branch>`).
2. **Develop** — make all changes on that branch, committing as needed.
3. **Push + PR** — when finished, push the branch and create a pull request. Do not push to `main` directly.
4. **User reviews** — the user checks the changes on GitHub and merges the PR, then deletes the branch on GitHub.
5. **Sync to main** — when the user reports that the PR has been merged, run `git checkout main && git pull origin main && git branch -d <branch>` to clean up the local branch and land on the updated `main`.
6. **Repeat** — the next piece of work starts a new branch from step 1.

**Critical rule:** Stay on the current open branch for ALL follow-up prompts in a session. Do NOT create a new branch for each prompt. Only move to a new branch after the user says something like "I merged the pull request to main and deleted your branch. Sync to main." Multiple prompts within the same work session should all land as commits on the same branch/PR.

**GitHub issues workflow:**
- Link commits to the issue using `fixes #N` or `refs #N` in the commit message.
- Do NOT close issues — the user closes them manually after verifying on Railway.
- Do NOT add test plans to pull requests. Instead, post the test plan as a **comment on the issue** so the user can work through it after deployment.

## Local development

```bash
# Terminal 1 — backend
pip install -r backend/requirements.txt
DATABASE_PUBLIC_URL=postgresql://localhost/endermatx uvicorn backend.main:app --reload

# Terminal 2 — frontend (proxies /api → :8000)
cd frontend && npm install && npm run dev   # Vite dev server at :5173
```

Vite proxies `/api/*` to `http://localhost:8000` (configured in `vite.config.js`).

## Repo structure

```
backend/
  main.py          ← FastAPI app, lifespan, static mounts, /api/info, EOD scheduler
  database.py      ← SQLAlchemy engine (reads DATABASE_PUBLIC_URL / DATABASE_URL)
  models.py        ← All SQLAlchemy table models
  schemas.py       ← Pydantic request/response schemas
  routers/
    tts.py  cal.py  idx.py  strings.py  bpm.py  scan.py  wmt.py
frontend/
  index.html       ← Vite entry (loads Inter font from Google Fonts)
  vite.config.js   ← Injects __GIT_HASH__, __GIT_HASH_FULL__ at build
  package.json     ← npm metadata only (version field is not used for display)
  src/
    main.jsx       ← React entry
    App.jsx        ← BrowserRouter + Routes + ThemeProvider + ThemeToggle
    index.css      ← All shared styles (CSS variables, design tokens, topbar, page, cards, landing)
    api.js         ← Typed fetch wrappers for every API endpoint
    spotify.js     ← Spotify Web API helpers (used by spt)
    bpm.js         ← BPM-resolution helpers (used by spt)
    context/
      ThemeContext.jsx  ← Theme state (dark/light), localStorage persistence, data-theme attribute
    pages/         ← One file per route (Home, Productivity, Personal, Games, tools…)
    components/
      ThemeToggle.jsx   ← Lightbulb toggle button + flyout (rendered globally in App.jsx)
games/             ← Legacy static game files (served at /games by FastAPI StaticFiles)
  teleport-tap/index.html
  mobs-magic/index.html
```

The `productivity/`, `personal/`, and root `index.html` in the repo root are legacy static files — they are **not served** by the current stack. The React SPA handles all those routes.

## Site navigation structure

Three levels deep, all handled by React Router:

```
/                 ← Home (category cards)
  /productivity   ← Productivity category page
    /tts          ← Time tracker
    /cal          ← Calendar
    /idx          ← Idea inbox
  /personal       ← Personal category page
    /str          ← String tracker
    /bpm          ← BPM tap counter
    /spt          ← Spotify explorer
    /wmt          ← WM 2026 Tipp-Assistent
  /games          ← Games category page (React)
    /block-hero            ← React game (BlockHero.jsx)
    /games/teleport-tap/   ← Static legacy game (served from games/ dir)
    /games/mobs-magic/     ← Static legacy game (served from games/ dir)
```

Navigation pages (Home, Productivity, Personal, Games) use the `.landing-page` layout. Tool pages use the `.topbar` + `.page` layout.

## Design system

All colours are defined as CSS variables in `frontend/src/index.css`. The site supports **dark mode** (default) and **light mode**, switched via the theme toggle (see below).

### CSS variable palette

| Variable | Dark value | Light value | Role |
|----------|-----------|-------------|------|
| `--bg` | `#07091a` | `#f0f4ff` | Page background |
| `--surface` | `#0d1221` | `#ffffff` | Card / input background |
| `--surface-alt` | `#111828` | `#eaf0ff` | Hover state / elevated surface |
| `--surface-dark` | `#111` | `#f4f7ff` | Darker surface variant |
| `--topbar-bg` | `#070914` | `#e8eef8` | Topbar background |
| `--border` | `#1a2840` | `#c8d4e8` | Default border |
| `--border-hover` | `#2a3d5c` | `#9ab0d0` | Hover border |
| `--border-dark` | `#1e1e1e` | `#d8e0f0` | Separator within surfaces |
| `--text-primary` | `#eef2ff` | `#0d1a35` | Main text |
| `--text-secondary` | `#9ab0d0` | `#3d5880` | Secondary text |
| `--text-muted` | `#5d7592` | `#4a6080` | Muted labels |
| `--text-dim` | `#374d66` | `#8a9fb8` | Very dim / decorative |
| `--text-bright` | `#e0e0e0` | `#1a2840` | Near-primary content text |
| `--text-sub` | `#bbbbbb` | `#3d5062` | Subtitle / meta text |
| `--text-subtle` | `#aaaaaa` | `#4a6078` | Subtle labels |
| `--text-faint` | `#888888` | `#607080` | Faint annotations |
| `--text-faintest` | `#666666` | `#748898` | Barely-visible hints |
| `--timer-inactive` | `#2a2a2a` | `#c0ccdd` | TTS timer when not running |
| `--overlay-bg` | `rgba(4,6,18,0.9)` | `rgba(10,20,50,0.7)` | Modal backdrop |
| `--error-bg` | `#2a0000` | `#fff0f0` | Error message background |

Additional TTS-specific state variables (all prefixed `--tts-`): `--tts-stop-bg`, `--tts-stop-hover`, `--tts-start-hover-bg`, `--tts-live-border`, `--tts-live-bg`, `--tts-active-bg`, `--tts-today-border`, `--tts-today-bg`. IDX swipe variables: `--swipe-promote-bg`, `--swipe-defer-bg`, `--swipe-kill-bg`.

**Colours that are NOT themed** (intentionally hardcoded because they are semantic/data-viz):
- Project/chart palette colours (`#4a9eff`, `#e74c3c`, `#2ecc71`, etc.)
- Status accent colours (`#8855ff` purple, `#7effa0` green, `#ff6b6b` red, `#4d6fa0` blue, `#f44336` danger)
- Enderman character colours (body blacks, `#cc00ee` eye glow)
- External brand colours (`#1db954` Spotify green)

**Typography:** Inter (400/500/600) loaded via Google Fonts in `frontend/index.html`. Fallback: `-apple-system, BlinkMacSystemFont, sans-serif`. No monospace anywhere in the UI.

**Layout:**
- Fixed topbar: `height: 32px`, `background: var(--topbar-bg)`, `border-bottom: 1px solid var(--border)`, `z-index: 50`. `topbar-right` has `padding-right: 22px` to leave room for the theme toggle.
- Tool pages: `.page` — `margin-top: 32px`, `padding: 20px 16px 52px`, `max-width: 720px`, centered
- Landing/category pages: `.landing-page` — centered column, `padding: 80px 20px 64px`

**Navigation cards** (`.nav-card`): three-column flex row — label (`var(--text-dim)`, `0.6rem`), name (`var(--text-primary)`, `0.9rem`, `font-weight: 500`), arrow (`→`, `var(--text-dim)`). Background `var(--surface)`, border `var(--border)`, hover border `var(--border-hover)`.

**Category page header:** `landing-crumb` link back to parent (tiny, `var(--text-dim)`), then `landing-title` (`1.25rem`, `font-weight: 600`, lowercase).

### Theme toggle

**Component:** `frontend/src/components/ThemeToggle.jsx`  
**Context:** `frontend/src/context/ThemeContext.jsx`

`ThemeProvider` wraps the entire app in `App.jsx`. On mount it reads `localStorage.getItem('theme')` (defaults to `'dark'`), immediately sets `document.documentElement.setAttribute('data-theme', theme)` (in the `useState` initialiser, so no flash on first render), and persists any change back to `localStorage`.

`ThemeToggle` is rendered once in `App.jsx`, outside the router, as a `position: fixed; top: 0; right: 0; width: 28px; height: 32px; z-index: 200` element. It displays a lightbulb SVG icon that aligns with the topbar on tool pages and floats at the top-right corner on landing pages. Clicking it opens a small flyout with **dark** and **light** options; clicking outside or pressing Escape closes it.

**Theming scope:** every React page (navigation pages + all tool pages) is themed. BlockHero (React game) is intentionally excluded. The two legacy static games (`teleport-tap`, `mobs-magic`) cannot be themed as they are separate static HTML files with no connection to the React app.

## Backend patterns

### Database (PostgreSQL)

`backend/database.py` reads `DATABASE_PUBLIC_URL` (preferred) or `DATABASE_URL` from env, fixing the `postgres://` → `postgresql://` prefix. `pool_pre_ping=True` handles Railway's connection recycling.

Tables are created via `Base.metadata.create_all` in the FastAPI `lifespan`. There are no migration files — schema changes require manual column additions or table drops in Railway's Postgres console.

### Router conventions

Each router (`backend/routers/*.py`) follows the same pattern:
- `GET /api/<tool>/…` — list or fetch
- `POST /api/<tool>/…` — create
- `PUT /api/<tool>/…` — update (full replace)
- `DELETE /api/<tool>/…` — delete
- All return Pydantic schemas, not raw SQLAlchemy models.

### EOD scheduler

`main.py` runs an APScheduler `CronTrigger(hour=23, minute=0)` that auto-closes any open TTS timer entries at 23:00 daily. It also auto-generates a WMT morning summary at 08:00 daily (if WMT matches exist).

## Frontend patterns

### API client (`frontend/src/api.js`)

All backend calls go through typed wrappers in `api.js`. Never call `fetch` directly in a page component. Each tool namespace (`tts`, `cal`, `idx`, `str`, `wmt`) exports typed methods.

### Theme system

`ThemeContext` is the only global React context. All pages and components access the current theme via `useTheme()` if they need it, but most theming is handled automatically through CSS variables — pages rarely need to import the context directly.

When writing inline `style={{}}` props, **always use CSS variables** for structural colours (`var(--surface)`, `var(--border)`, `var(--text-primary)`, etc.). Never hardcode structural hex values in JSX — they will break in light mode. Data-viz and semantic accent colours (`#8855ff`, `#7effa0`, `#f44336`, project palette colours, etc.) may remain hardcoded.

### State model

Each tool page manages its own state with `useState` hooks. On mount it fetches from the API. On mutation it calls the API immediately or with a 1500 ms debounce for text fields (`scheduleSave`). There is no global state store other than `ThemeContext`.

### Per-tool versioning

Each tool page owns its own version string, displayed in the topbar's right side as `.topbar-version`. The version is a hardcoded `x.y` string directly in the page file — no shared file, no build-time injection.

**Where to find it:** look for `v1.0` (or current version) in the `<span className="topbar-version">` inside the topbar of each tool page.

**When to bump:** increment the minor version (`1.0` → `1.1`) of the **affected tool only** when that tool's page changes in a PR. Other tools' versions are never touched. Major bump only when the user explicitly asks.

**Why this design:** a single shared version (e.g. `package.json`) causes conflicts when multiple parallel branches each bump it independently. Per-tool versions in the tool's own file eliminate that coordination problem — two branches working on different tools never touch the same version string.

**Current versions (as of last CLAUDE.md update):**

| Tool | Version |
|------|---------|
| tts  | v4.0 |
| cal  | v4.4 |
| idx  | v4.2 |
| str  | v4.0 |
| bpm  | v4.0 |
| spt  | v4.9 |
| wmt  | v3.3 |
| block-hero | v1.0 |

There is no global version footer. `vite.config.js` still injects `__GIT_HASH__` and `__GIT_HASH_FULL__` (Railway fallback: `RAILWAY_GIT_COMMIT_SHA`) but these are not currently displayed.

## Tools reference

### Productivity

- **tts** (`/tts`) — Time tracker. Projects with colored labels; tracks time segments. Stats tab: all-time bars, this-week bars, daily stacked breakdown (week-navigable), project × weekday heatmap.
- **cal** (`/cal`) — Calendar. Month tiles across a configurable date range. Project timelines as colored date ranges. Holiday overlays for DE, AT, US, GB, FR, CN, JP.
- **idx** (`/idx`) — Idea inbox. Frictionless capture (Enter to log). Three views: IN / DO / BL with counters. Statuses: `inbox`, `promoted`, `deferred`, `done`, `killed`.

### Personal

- **str** (`/str`) — String tracker. Guitar string change dates with per-guitar thresholds (default 30 days). Status: fresh (< 3 days), warn-yellow (≥ 75% threshold), warn-red (≥ threshold).
- **bpm** (`/bpm`) — BPM tap counter. Tap or press Space to measure tempo; auto-resets after 3 s of inactivity. Backed by `backend/routers/bpm.py` + `scan.py` for Spotify track scanning.
- **spt** (`/spt`) — Spotify explorer. Browse and play Spotify tracks, view BPM and waveform data. Uses `frontend/src/spotify.js` and `frontend/src/bpm.js`. No dedicated backend router — calls Spotify Web API directly from the browser.
- **wmt** (`/wmt`) — WM 2026 Tipp-Assistent. See detailed section below.

### Games

- **block-hero** (`/block-hero`) — Minecraft-themed rhythm game. 4-lane falling-block game with 100 procedurally generated tracks (33 easy / 33 medium / 34 hard), difficulty selection, combo multiplier, miss limit, and a Web Audio synthesiser for sound. Entirely self-contained in `BlockHero.jsx` — no backend, no database. Keys: D / F / J / K.
- **teleport-tap** (`/games/teleport-tap/`) — Legacy static game.
- **mobs-magic** (`/games/mobs-magic/`) — Legacy static game.

## WMT — WM 2026 Tipp-Assistent

Full tournament prediction assistant for the 2026 FIFA World Cup (104 matches). Backend router: `backend/routers/wmt.py`. Frontend page: `frontend/src/pages/Wmt.jsx`.

### Data sources

Match data is fetched via one of two sources, tried in order:
1. **football-data.org v4** (`FOOTBALL_DATA_API_KEY` env var required) — all 104 matches, full schedule including knockout rounds.
2. **openligadb.de** (no API key) — fallback, only covers Matchday 1.

### Database models (`backend/models.py`)

| Model | Table | Purpose |
|-------|-------|---------|
| `WmtTeam` | `wmt_teams` | Team with ELO rating, TLA, name, matches played |
| `WmtMatch` | `wmt_matches` | Match with stage, group, date, teams, score, status |
| `WmtPrediction` | `wmt_predictions` | ELO-based prediction snapshot per match (history kept) |
| `WmtSummary` | `wmt_summaries` | Daily morning report (markdown) |
| `WmtBonusPrediction` | `wmt_bonus_predictions` | Monte-Carlo tournament simulation result |
| `WmtOpponentTip` | `wmt_opponent_tips` | Imported tip of a fellow Tipprunde player for a given match |

### ELO prediction engine

- **K-factor**: 60 (WC tournament weight)
- **`elo_to_win_prob(home, away)`** — win/draw/away probabilities with draw modelled as a Gaussian around zero ELO difference
- **`elo_to_expected_goals(home, away)`** — home/away xG scaled around `WC_AVG_GOALS = 1.35`
- **`update_elo_after_match(...)`** — updates ELOs after a result, with goal-difference multiplier
- **`do_historical_warmup(db)`** — re-calibrates ELOs using openligadb data for WM2014 → EM2024 with form-decay K-factor (older matches count less)

### Refresh flow (`do_refresh`)

1. Fetch all matches from API; upsert teams and matches
2. For newly-finished matches: update ELOs (`update_elo_after_match`)
3. `_auto_assign_next_round(db)` — if a round is now complete, fill the next round's empty team slots (strongest vs. weakest by ELO pairing)
4. Regenerate `WmtPrediction` rows for all upcoming matches where ELO shifted ≥ 5 points

### Auto-assign chain

When a stage becomes fully complete, `_auto_assign_next_round` fills the next stage:
```
GROUP_STAGE (all 3 MDs) → LAST_32 (top-2 per group + best 8 third-placed)
LAST_32  → LAST_16
LAST_16  → QUARTER_FINALS
QUARTER_FINALS → SEMI_FINALS
SEMI_FINALS → FINAL (winners) + THIRD_PLACE (losers)
```

### Bonus prediction (`do_generate_bonus`)

Monte-Carlo simulation (10 000 runs) of the full tournament. Outputs: tournament winner, finalists, semi-finalists, group winner probabilities, top-scorer estimate. Frozen (UI-locked) one day before the tournament starts. After the Final is finished, the Bonus view automatically shows a "PROGNOSE vs. REALITÄT" comparison section.

### Morning summaries (`do_generate_summary`)

Generates a markdown report for all matches played on a given date: results, prediction accuracy (tendency), upsets. Stored in `WmtSummary`. Auto-generated daily at 08:00 by the APScheduler. Can also be manually triggered per-date via the calendar picker in the burger menu.

### Gossip in morning reports

`do_generate_summary` optionally appends a "## Gossip" section: real news snippets about the day's teams are fetched from NewsAPI (`NEWS_API_KEY`, `/v2/everything`, query built from team short names, date range = target..target+2 days), then turned into 3-5 short, lighthearted German tabloid-style headlines by the Claude API (`ANTHROPIC_API_KEY`, model `claude-haiku-4-5-20251001`). The prompt explicitly requires a respectful, non-stereotyping tone — humor comes from sporting drama, not mockery of nations/cultures. Both calls fail silently (logged as warnings) if a key is missing or the request errors, so the rest of the report always renders.

### Opponent tip tracking (`WmtOpponentTip`)

Kicktipp.de has no public API for reading fellow players' tips, so they're imported manually: once tip deadlines pass and Kicktipp reveals the "Tippübersicht" table, the user screenshots it and Claude (vision) parses player names + predicted scores, then calls `POST /api/wmt/opponents/import` with `{tips: [{player_name, home_tla, away_tla, pred_home_goals, pred_away_goals}, ...]}`. The endpoint resolves each tip to a `WmtMatch` via the team TLAs (most recent match between that pairing) and upserts a `WmtOpponentTip` row per `(match_id, player_name)`. Unresolvable tips (unknown TLA / no matching match) are skipped and counted separately in the response. This is purely additive groundwork — it does not touch the ELO prediction engine — laid in place ahead of the tournament so the daily screenshot→import workflow is ready to go from day one.

**Daily import workflow (for Claude in any session — chat, web, or CLI):**
1. The user sends one or more screenshots of Kicktipp's "Tippübersicht" table directly in the chat (not via the app — there is no upload UI for this).
2. Claude (vision) reads the screenshot(s) and extracts each player's name and predicted score per match. Tips are hidden as `-:-` until each match's deadline passes — only screenshots taken after reveal contain real scores.
3. Claude maps the team names/short codes shown in the table header to TLAs (e.g. "MEX" / "SAFR" / "KAN" / "BIH") and POSTs the parsed data to `/api/wmt/opponents/import`.
4. The response reports how many tips were imported vs. skipped (unresolved TLA or no matching match) — relay that to the user.
5. Imported tips immediately appear in the **Konkurrenz** tab, grouped by match with ELO-Tipp comparison and tip-distribution tally.

### Frontend views (`Wmt.jsx` — v3.0)

The page has six tabs:

| Tab | Content |
|-----|---------|
| **Import** | Log output for all async operations (refresh, fake, warmup, etc.) |
| **Spieltage** | Match cards grouped by matchday/stage; sub-grouped by calendar day for group stage. Shows ELO-based tipp-Empfehlung, win/draw/loss prob bar, VERLAUF (prediction history with change notes) |
| **Gruppen-Tabellen** | Live group standings for all 12 groups (A–L) in a 2-column grid. Columns: Sp / W / U / N / Tore / TD (coloured) / Pkt. Derived from match data, updates on every refresh/fake |
| **Konkurrenz** | Imported opponent tips (`WmtOpponentTip`) grouped by match: ELO-Tipp + win/draw/loss probabilities, tip-distribution tally (Heimsieg/Unentschieden/Auswärtssieg), and a per-player score table. Empty-state hint until tips are imported |
| **Bonus-Tipps** | Monte-Carlo simulation results. Shows PROGNOSE vs. REALITÄT comparison at top once the Final is finished |
| **Morgenberichte** | Daily match summaries in reverse-chronological order |

**Matchday/stage selector:** pill buttons; active stages highlighted green (live), finished stages dimmed.

**Team colour coding:** Only in the MD3 matchday view. Green = safely qualified for Rd.32 after MD2 results; red = safely eliminated. Determined by a pure-JS standings computation over all group matches.

**Tipp suggestions:** For knockout stages the displayed tip (rounded xG) is never a draw — the higher-probability side gets +1 if scores tie. This applies to both the current tip and the VERLAUF history.

**Burger menu actions:**
- Spielplan aktualisieren (refresh from API)
- Historische Kalibrierung (ELO warmup via openligadb)
- Bonus-Prognose berechnen (locked one day before tournament)
- Morgenbericht erstellen (calendar picker → generates summary for selected date)
- Daten löschen
- Fake alles (MD1–Finale in one call)
- Individual fake buttons: MD1 / MD2 / MD3 / Rd.32 / Achtelfinale / Viertelfinale / Halbfinale / Spiel um Platz 3 / Finale (each unlocks sequentially)

### Dev/test fake endpoints

All under `POST /api/wmt/debug/…`:

| Endpoint | Action |
|----------|--------|
| `fake-md1` | Fake Matchday 1 results (3 upsets) |
| `fake-md2` | Fake Matchday 2 results (5 upsets) |
| `fake-md3` | Fake Matchday 3 results (7 upsets) |
| `fake-rd32` | Fake Rd. 32 results (5 upsets); draws always broken |
| `fake-last16` | Fake Last-16 results (3 upsets) |
| `fake-qf` | Fake Quarter-Finals (2 upsets) |
| `fake-sf` | Fake Semi-Finals (1 upset) |
| `fake-tp` | Fake Third-Place play-off (0 upsets) |
| `fake-final` | Fake Final (0 upsets); triggers bonus comparison |
| `fake-all` | Chain all stages in one call (ELO updates between stages, predictions only once at end) |

### Key API endpoints (selected)

```
GET  /api/wmt/status            → match_count, prediction_count, calibrated, md*_done, rd32_done
GET  /api/wmt/matches           → all matches with nested team + latest prediction + prediction history
GET  /api/wmt/teams             → all teams with ELO
GET  /api/wmt/opponents         → imported opponent tips (optional ?match_id= filter)
POST /api/wmt/opponents/import  → import/update opponent tips (resolved via team TLAs)
GET  /api/wmt/summaries         → all morning reports
GET  /api/wmt/bonus             → latest bonus prediction
POST /api/wmt/refresh           → fetch + ELO update + predictions
POST /api/wmt/warmup            → historical ELO calibration
POST /api/wmt/summary/generate  → generate yesterday's morning report
POST /api/wmt/summary/generate/{date}  → generate morning report for a specific date
POST /api/wmt/bonus/generate    → run Monte-Carlo simulation
POST /api/wmt/clear             → wipe all WMT data
```

## Adding a new tool

1. **Backend**: add model(s) to `backend/models.py`, schemas to `backend/schemas.py`, router to `backend/routers/<name>.py`, import and register in `backend/main.py` with prefix `/api/<name>`.
2. **Frontend API**: add a namespace to `frontend/src/api.js`.
3. **Frontend page**: create `frontend/src/pages/<Name>.jsx` following the topbar + page layout. Use CSS variables (`var(--surface)`, `var(--border)`, `var(--text-primary)`, etc.) for all structural colours in inline styles — never hardcode `#07091a`, `#0d1221`, `#1a2840` etc.
4. **Routing**: add a `<Route>` in `frontend/src/App.jsx`.
5. **Navigation**: add an entry to the appropriate category page (`Productivity.jsx`, `Personal.jsx`, or `Games.jsx`).
6. **Version**: set `<span className="topbar-version">v1.0</span>` in the new tool's topbar (starts at `1.0`).

## Build commands

```bash
# Frontend
cd frontend && npm run build   # outputs to frontend/dist/

# Backend (no compilation needed)
uvicorn backend.main:app --reload
```

There are no linters or automated tests. `npm run build` is the only correctness gate — fix any Vite errors it surfaces before pushing.
