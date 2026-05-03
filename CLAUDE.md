# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A collection of self-contained browser tools deployed to GitHub Pages at `matmaxx2317.github.io/endermatx`. No build system, no package manager, no dependencies. Every tool is a single `index.html` with all CSS and JS inline.

## Deployment

Push to `main` → GitHub Pages deploys automatically. The root `index.html` polls the GitHub Actions API every 5 seconds to show live deploy status. Commit messages follow the pattern:

```
deploy: <path/to/file> - DD.MM.YYYY HH:MM
```

**Always push directly to `main`.** Do not use feature branches or PRs — commit and push straight to `main` every time.

## Site structure

Navigation is three levels deep:

```
index.html              ← landing page (enderman animation + category cards)
  productivity/         ← category page → tts, cal, pom, mtg
  personal/             ← category page → str, crd
  games/                ← category page (placeholder, "coming soon")
```

The landing page and category pages share a common visual language: background `#2a2a2a`, monospace font, single-column card grid, stacked 3-line uppercase `<h1>`. Category pages have a ← back card as the first nav item.

The landing page includes a CSS-animated enderman that walks across the page at variable speed and teleports every 3–5 seconds with purple particles (`#cc00ee`).

## Architecture: shared patterns across all tools

Every tool follows the same structure. Understanding one means understanding all.

### Gist sync (cross-device persistence)

All tools store data in a private GitHub Gist, synced via the GitHub API. Credentials (PAT + Gist ID) live in `localStorage` under tool-specific keys:

| Tool | localStorage keys | Gist filename |
|------|------------------|---------------|
| tts  | `tt_token`, `tt_gist_id` | `tt_data.json` |
| cal  | `cal_token`, `cal_gist_id` | `cal_data.json` |
| pom  | `pom_token`, `pom_gist_id` | `pom_data.json` |
| mtg  | `mtg_token`, `mtg_gist_id` | `mtg_data.json` |
| str  | `str_token`, `str_gist_id` | `str_data.json` |

The sync flow in every tool:
1. On init: `loadCredentials()` → `pullFromGist()` → render
2. On state change: `schedulePush()` debounces `pushToGist()` by 1500ms
3. A "Setup" modal accepts a GitHub PAT (scope: `gist`) and optional Gist ID. First device creates the Gist; subsequent devices enter the returned ID.

### State model

Each tool keeps a single `state` (or `data`) object in memory. Mutations happen directly on this object, followed by a `renderX()` call and `schedulePush()`. There is no reactive framework — rendering is always triggered explicitly.

### UI conventions

- Landing/category pages: background `#2a2a2a`; tool pages: background `#0d0d0d` or `#0e0e0e`; font everywhere: `'Courier New', Courier, monospace`
- Sync status shown in a fixed top bar (`#syncBar`) with color-coded states: syncing (yellow), synced (green/tool-color), error (red). Left side shows tool name + version; right side shows status dot + "Setup" button.
- HTML escaping uses an inline `escHtml()` / `esc()` helper — always use it when rendering user-supplied strings into innerHTML
- IDs use numeric timestamps (`Date.now()`) as unique identifiers for projects/entries/meetings/guitars

## Tools reference

### Productivity (`productivity/`)

- **tts** (`tts/`) — Time tracker. Projects with colored labels; tracks time segments per project per session. Reports: week/month/all-time bar charts, heatmap (project × weekday), context-switch analysis.
- **cal** (`cal/`) — Calendar. Month tiles across a configurable date range. Project timelines overlaid as colored date ranges. Holiday overlays for DE, AT, US, GB, FR, CN, JP (computed via Easter algorithm + fixed dates).
- **pom** (`pom/`) — Pomodoro. 25-min work / 5-min break cycles. Timer state persists to Gist every 60 ticks so it survives page reloads. Snarky message pool in `MESSAGES` object, randomized via `pick()`.
- **mtg** (`mtg/`) — Meeting notes. Meetings with title, date, attendees, freeform notes, and action items. "Summarize" generates a plain-text summary locally (no AI). Cross-meeting actions view with open/done/all filter.

### Personal (`personal/`)

- **str** (`str/`) — String tracker. Tracks guitar string change dates with per-guitar thresholds (default 30 days). Status colors: fresh (< 3 days), warn-yellow (≥ 75% of threshold), warn-red (≥ threshold or never changed).
- **crd** (`crd/`) — Chord aligner. Paste lyrics + a reference audio URL; auto-aligns chord annotations to lyric positions.

### Games (`games/`)

Placeholder, currently empty ("coming soon").

## Adding a new tool

1. Create `<name>/index.html` following the existing pattern (fixed `#syncBar`, setup modal, Gist sync functions, `schedulePush` debounce).
2. Choose a new `localStorage` key prefix to avoid collisions.
3. Add a `.card` entry to the appropriate category page (`productivity/index.html`, `personal/index.html`, or `games/index.html`) with the next sequential label number.
4. The root `index.html` only lists categories — no changes needed there unless a new category is added.

## Versioning (tts)

The `tts` tool displays a version in its `<h1>` title bar (e.g. `v1.0`). **With every PR created for tts, increment the minor version** (e.g. `v1.0` → `v1.1` → `v1.2`). Increment the major version only when the user explicitly asks. The current version is whatever is in `tts/index.html` at the time — read it before creating a PR and bump it then.

## No build, lint, or test commands

There are no npm scripts, no linters, and no automated tests. Preview by opening any `index.html` directly in a browser or serving with any static file server (e.g. `python3 -m http.server` from the repo root).
