# `meeting` skill

Live meeting capture for Claude Code: start a meeting, drop notes/facts/decisions/action
items as it runs, get a structured wrap-up when you're done. Notes are stored as one
markdown file per meeting under `meeting-notes/` **in the repo**, and each meeting is
published as its own branch + pull request on wrap-up.

## Use it

- **Start:** `Meeting Q3 Roadmap Sync started` (or `/meeting Q3 Roadmap Sync`)
- **Capture:** just type notes as they come — each line is filed into Notes / Facts /
  Decisions / Action items automatically.
- **Finish:** `meeting done` → you get a summary + consolidated action items in chat,
  the full record saved to `meeting-notes/`, and a dedicated branch + PR opened for it
  (`meeting-notes/YYYY-MM-DD-HHMM-<slug>`).

## Install it at work (global)

This copy lives in the repo, so it only activates in sessions started here. To use it in
**any** project at work, copy it into your personal skills directory:

```bash
mkdir -p ~/.claude/skills/meeting
cp .claude/skills/meeting/SKILL.md ~/.claude/skills/meeting/SKILL.md
```

After that, `/meeting` is available in every Claude Code session on that machine.
In any git repo, notes land in that repo's `meeting-notes/` and wrap-up opens a branch + PR;
outside a git repo it falls back to `~/meeting-notes/` and skips the PR step.
