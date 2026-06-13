# `meeting` skill

Live meeting capture for Claude Code: start a meeting, drop notes/facts/decisions/action
items as it runs, get a structured wrap-up when you're done. Notes are stored as one
markdown file per meeting under `~/meeting-notes/`.

## Use it

- **Start:** `Meeting Q3 Roadmap Sync started` (or `/meeting Q3 Roadmap Sync`)
- **Capture:** just type notes as they come — each line is filed into Notes / Facts /
  Decisions / Action items automatically.
- **Finish:** `meeting done` → you get a summary + consolidated action items in chat,
  and the full record saved to `~/meeting-notes/`.

## Install it at work (global)

This copy lives in the repo, so it only activates in sessions started here. To use it in
**any** project at work, copy it into your personal skills directory:

```bash
mkdir -p ~/.claude/skills/meeting
cp .claude/skills/meeting/SKILL.md ~/.claude/skills/meeting/SKILL.md
```

After that, `/meeting` is available in every Claude Code session on that machine.
Notes always land in `~/meeting-notes/` regardless of which repo you're in.
