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
  productivity/         ← category page
    tts/                ← time tracker
    cal/                ← calendar
    pom/                ← pomodoro
    mtg/                ← meeting notes
    idx/                ← idea inbox
  personal/             ← category page
    str/                ← string tracker
    crd/                ← chord aligner
  games/                ← category page
    teleport-tap/       ← game
    mobs-magic/         ← game
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
| idx  | `idx_token`, `idx_gist_id` | `idx_data.json` |
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

- **tts** (`productivity/tts/`) — Time tracker. Projects with colored labels; tracks time segments per project per session. Reports: week/month/all-time bar charts, heatmap (project × weekday), context-switch analysis.
- **cal** (`productivity/cal/`) — Calendar. Month tiles across a configurable date range. Project timelines overlaid as colored date ranges. Holiday overlays for DE, AT, US, GB, FR, CN, JP (computed via Easter algorithm + fixed dates).
- **pom** (`productivity/pom/`) — Pomodoro. 25-min work / 5-min break cycles. Timer state persists to Gist every 60 ticks so it survives page reloads. Snarky message pool in `MESSAGES` object, randomized via `pick()`.
- **mtg** (`productivity/mtg/`) — Meeting notes. Meetings with title, date, attendees, freeform notes, and action items. "Summarize" generates a plain-text summary locally (no AI). Cross-meeting actions view with open/done/all filter.
- **idx** (`productivity/idx/`) — Idea inbox. Frictionless capture (one input, Enter to log). Three views: Inbox, Promoted, Deferred — each with a counter. Actions per status: inbox → promote / defer / kill; deferred → promote / kill; promoted → kill. Click an inbox item to edit it inline. Ideas never demoted once promoted. Gist-synced.

### Personal (`personal/`)

- **str** (`personal/str/`) — String tracker. Tracks guitar string change dates with per-guitar thresholds (default 30 days). Status colors: fresh (< 3 days), warn-yellow (≥ 75% of threshold), warn-red (≥ threshold or never changed).
- **crd** (`personal/crd/`) — Chord aligner. Paste lyrics + a reference audio URL; auto-aligns chord annotations to lyric positions.

### Games (`games/`)

- **teleport-tap** (`games/teleport-tap/`) — Game.
- **mobs-magic** (`games/mobs-magic/`) — Game.

## Adding a new tool

1. Create `<category>/<name>/index.html` following the existing pattern (fixed `#syncBar`, setup modal, Gist sync functions, `schedulePush` debounce). Reference the root favicon with `../../favicon.svg`.
2. Choose a new `localStorage` key prefix to avoid collisions.
3. Add a `.card` entry to the appropriate category page (`productivity/index.html`, `personal/index.html`, or `games/index.html`) using a relative path like `<name>/` (no `../` prefix).
4. The root `index.html` only lists categories — no changes needed there unless a new category is added.

## Versioning (all subprojects)

Every subproject displays its version next to its title — small (`font-size:10px`), gray (`color:#bbb`), not bold, with condensed letter-spacing (`0.05em`) — using the format `vMAJOR.MINOR` (e.g. `v1.0`, `v2.11`).

**Rules:**
- **Minor bump** — with every commit that changes a tool's `index.html`, increment the minor part (e.g. `v2.11` → `v2.12`). The minor version is a plain integer: after `v2.9` comes `v2.10`, not `v3.0`.
- **Major bump** — only when the user explicitly asks; reset minor to `0` (e.g. `v1.4` → `v2.0`).
- Always read the current version from the file before bumping.

**Current versions** (update this table whenever a version changes):

| Tool | Path | Version |
|------|------|---------|
| tts  | `productivity/tts/index.html` | v2.11 |
| cal  | `productivity/cal/index.html` | v1.3 |
| pom  | `productivity/pom/index.html` | v1.0 |
| mtg  | `productivity/mtg/index.html` | v1.0 |
| idx  | `productivity/idx/index.html` | v1.0 |
| str  | `personal/str/index.html` | v1.0 |
| crd  | `personal/crd/index.html` | v1.0 |
| teleport-tap | `games/teleport-tap/index.html` | v1.0 |
| mobs-magic | `games/mobs-magic/index.html` | v1.0 |

## No build, lint, or test commands

There are no npm scripts, no linters, and no automated tests. Preview by opening any `index.html` directly in a browser or serving with any static file server (e.g. `python3 -m http.server` from the repo root).
