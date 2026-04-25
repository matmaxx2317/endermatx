# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A collection of self-contained browser tools deployed to GitHub Pages at `matmaxx2317.github.io/endermatx`. No build system, no package manager, no dependencies. Every tool is a single `index.html` with all CSS and JS inline.

## Deployment

Push to `main` → GitHub Pages deploys automatically. The root `index.html` polls the GitHub Actions API every 5 seconds to show live deploy status. Commit messages follow the pattern:

```
deploy: <path/to/file> - DD.MM.YYYY HH:MM
```

The `deploy/index.html` tool is a browser-based UI for committing files directly via the GitHub API (useful for quick edits without git).

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

- Background: `#0d0d0d` or `#0e0e0e`; font: `'Courier New', Courier, monospace`
- Sync status shown in a fixed top bar with color-coded states: syncing (yellow), synced (green/tool-color), error (red)
- HTML escaping uses an inline `escHtml()` / `esc()` helper — always use it when rendering user-supplied strings into innerHTML
- IDs use numeric timestamps (`Date.now()`) as unique identifiers for projects/entries/meetings/guitars

## Tools reference

- **tts** (`tts/`) — Time tracker. Projects with colored labels; tracks time segments per project per session. Reports: week/month/all-time bar charts, heatmap (project × weekday), context-switch analysis.
- **cal** (`cal/`) — Calendar. Month tiles across a configurable date range. Project timelines overlaid as colored date ranges. Holiday overlays for DE, AT, US, GB, FR, CN, JP (computed via Easter algorithm + fixed dates).
- **pom** (`pom/`) — Pomodoro. 25-min work / 5-min break cycles. Timer state persists to Gist every 60 ticks so it survives page reloads. Snarky message pool in `MESSAGES` object, randomized via `pick()`.
- **mtg** (`mtg/`) — Meeting notes. Meetings with title, date, attendees, freeform notes, and action items. "Summarize" generates a plain-text summary locally (no AI). Cross-meeting actions view with open/done/all filter.
- **str** (`str/`) — String tracker. Tracks guitar string change dates with per-guitar thresholds (default 30 days). Status colors: fresh (< 3 days), warn-yellow (≥ 75% of threshold), warn-red (≥ threshold or never changed).

## Adding a new tool

1. Create `<name>/index.html` following the existing pattern (fixed sync bar, setup modal, Gist sync functions, `schedulePush` debounce).
2. Choose a new `localStorage` key prefix to avoid collisions.
3. Add a `.card` entry to the root `index.html` nav grid with the next sequential label number.

## No build, lint, or test commands

There are no npm scripts, no linters, and no automated tests. Preview by opening any `index.html` directly in a browser or serving with any static file server (e.g. `python3 -m http.server` from the repo root).
