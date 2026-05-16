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
    tts.py  cal.py  idx.py  strings.py
frontend/
  index.html       ← Vite entry (loads Inter font from Google Fonts)
  vite.config.js   ← Injects __GIT_HASH__, __GIT_HASH_FULL__, __APP_VERSION__ at build
  package.json     ← version field drives __APP_VERSION__ (x.y format)
  src/
    main.jsx       ← React entry
    App.jsx        ← BrowserRouter + Routes + global <VersionFooter>
    index.css      ← All shared styles (design tokens, topbar, page, cards, landing)
    api.js         ← Typed fetch wrappers for every API endpoint
    pages/         ← One file per route (Home, Productivity, Personal, Games, tools…)
    components/    ← Shared components
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
  /games          ← Games category page (React)
    /games/teleport-tap/   ← Static legacy game (served from games/ dir)
    /games/mobs-magic/     ← Static legacy game (served from games/ dir)
```

Navigation pages (Home, Productivity, Personal, Games) use the `.landing-page` layout. Tool pages use the `.topbar` + `.page` layout.

## Design system

**Palette (hardcoded hex values, no CSS variables):**

| Role | Value |
|------|-------|
| Page background | `#07091a` |
| Surface / card | `#0d1221` |
| Topbar / footer bg | `#070914` |
| Border default | `#1a2840` |
| Border hover | `#2a3d5c` |
| Text primary | `#eef2ff` |
| Text secondary | `#9ab0d0` |
| Text muted / decorative | `#374d66` |
| Focus / accent | `#4d6fa0` |

**Typography:** Inter (400/500/600) loaded via Google Fonts in `frontend/index.html`. Fallback: `-apple-system, BlinkMacSystemFont, sans-serif`. No monospace anywhere in the UI.

**Layout:**
- Fixed topbar: `height: 32px`, `background: #070914`, `border-bottom: 1px solid #1a2840`, `z-index: 50`
- Fixed version footer: `height: 32px`, same background/border-top, `z-index: 40`
- Tool pages: `.page` — `margin-top: 32px`, `padding: 20px 16px 52px`, `max-width: 720px`, centered
- Landing/category pages: `.landing-page` — centered column, `padding: 80px 20px 64px`

**Navigation cards** (`.nav-card`): three-column flex row — label (`#374d66`, `0.6rem`), name (`#eef2ff`, `0.9rem`, `font-weight: 500`), arrow (`→`, `#374d66`). Background `#0d1221`, border `#1a2840`, hover border `#2a3d5c`.

**Category page header:** `landing-crumb` link back to parent (tiny, `#374d66`), then `landing-title` (`1.25rem`, `font-weight: 600`, lowercase).

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

`main.py` runs an APScheduler `CronTrigger(hour=23, minute=0)` that auto-closes any open TTS timer entries at 23:00 daily.

## Frontend patterns

### API client (`frontend/src/api.js`)

All backend calls go through typed wrappers in `api.js`. Never call `fetch` directly in a page component. Each tool namespace (`tts`, `cal`, `idx`, `str`) exports typed methods.

### State model

Each tool page manages its own state with `useState` hooks. On mount it fetches from the API. On mutation it calls the API immediately or with a 1500 ms debounce for text fields (`scheduleSave`). There is no global state store.

### Version baking

`vite.config.js` injects three build-time globals:

| Global | Source |
|--------|--------|
| `__GIT_HASH__` | `git rev-parse --short HEAD` (7 chars) |
| `__GIT_HASH_FULL__` | `git rev-parse HEAD` |
| `__APP_VERSION__` | `package.json` `version` trimmed to `x.y` |

Railway fallback: when `.git` is absent at build time, `RAILWAY_GIT_COMMIT_SHA` env var is used.

### Version footer

`App.jsx` renders a global `<VersionFooter>` fixed at the bottom of every page, showing `v{__APP_VERSION__}-{__GIT_HASH__}` as a link to the GitHub commit. This is the **only** place a version is displayed — there are no per-tool version labels.

**When to bump `package.json` version:**
- **Minor bump** (`1.0` → `1.1`) with every PR that changes any frontend page or component.
- **Major bump** only when the user explicitly asks.
- Format is always `x.y.0` in `package.json` (displayed as `x.y`).

**Current version:** see `frontend/package.json`.

## Tools reference

### Productivity

- **tts** (`/tts`) — Time tracker. Projects with colored labels; tracks time segments. Stats tab: all-time bars, this-week bars, daily stacked breakdown (week-navigable), project × weekday heatmap.
- **cal** (`/cal`) — Calendar. Month tiles across a configurable date range. Project timelines as colored date ranges. Holiday overlays for DE, AT, US, GB, FR, CN, JP.
- **idx** (`/idx`) — Idea inbox. Frictionless capture (Enter to log). Three views: IN / DO / BL with counters. Statuses: `inbox`, `promoted`, `deferred`, `done`, `killed`.

### Personal

- **str** (`/str`) — String tracker. Guitar string change dates with per-guitar thresholds (default 30 days). Status: fresh (< 3 days), warn-yellow (≥ 75% threshold), warn-red (≥ threshold).
- **bpm** (`/bpm`) — BPM tap counter. Tap or press Space to measure tempo; auto-resets after 3 s of inactivity.

### Games

- **teleport-tap** (`/games/teleport-tap/`) — Legacy static game.
- **mobs-magic** (`/games/mobs-magic/`) — Legacy static game.

## Adding a new tool

1. **Backend**: add model(s) to `backend/models.py`, schemas to `backend/schemas.py`, router to `backend/routers/<name>.py`, import and register in `backend/main.py` with prefix `/api/<name>`.
2. **Frontend API**: add a namespace to `frontend/src/api.js`.
3. **Frontend page**: create `frontend/src/pages/<Name>.jsx` following the topbar + page layout.
4. **Routing**: add a `<Route>` in `frontend/src/App.jsx`.
5. **Navigation**: add an entry to the appropriate category page (`Productivity.jsx`, `Personal.jsx`, or `Games.jsx`).
6. **Version bump**: increment `package.json` minor version.

## Build commands

```bash
# Frontend
cd frontend && npm run build   # outputs to frontend/dist/

# Backend (no compilation needed)
uvicorn backend.main:app --reload
```

There are no linters or automated tests. `npm run build` is the only correctness gate — fix any Vite errors it surfaces before pushing.
