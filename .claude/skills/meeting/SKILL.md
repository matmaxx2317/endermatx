---
name: meeting
description: Live meeting capture and wrap-up. Use when the user starts a meeting ("Meeting X started", "start meeting", "/meeting"), feeds notes/facts/decisions/action points during a meeting, or ends one ("meeting done", "wrap up", "end meeting"). Maintains a running markdown notes file per meeting and produces a structured summary on close. Built for back-to-back meetings (several per day).
---

# Meeting capture

A lightweight, stateful note-taker for live meetings. The user runs three phases — **start**, **capture**, **wrap-up** — usually across many messages in one session. Your job is to keep a clean running record in a file and turn it into a sharp summary at the end.

## Where notes live

Meetings are stored as markdown **inside the current repository**, under a `meeting-notes/`
directory at the repo root. One file per meeting:

```
<repo-root>/meeting-notes/YYYY-MM-DD-HHMM-<slug>.md
```

- Resolve `<repo-root>` with `git rev-parse --show-toplevel`. Create `meeting-notes/` there if it does not exist (`mkdir -p`).
- **Fallback (no git repo):** if `git rev-parse` fails (the session is not inside a git repository), fall back to `~/meeting-notes/` and skip the branch/PR steps in Phase 3 — there is nowhere to push.
- `<slug>` = the meeting title, lowercased, spaces → hyphens, non-alphanumerics stripped (e.g. "Q3 Roadmap Sync" → `q3-roadmap-sync`).
- **Remember the active file path for the whole session.** If you are ever unsure which file is active (e.g. after a long gap), list the `meeting-notes/` directory sorted by modification time and Read the newest file before continuing — never start a second file for the same meeting.

Keeping notes in-repo means every meeting record is versioned and, on wrap-up, lands in a pull request (see Phase 3) so it survives beyond this ephemeral session.

## Phase 1 — Start

Trigger: "Meeting <title> started", "start meeting <title>", "/meeting <title>", or similar.

1. Derive the title (everything after the start phrase). If no title is given, ask for one in a single short line, or use `untitled` if the user wants to just go.
2. Compute the file path using the current local date/time.
3. Write the initial file:

```markdown
# <Title>

- **Date:** YYYY-MM-DD HH:MM
- **Status:** in progress

## Notes

## Facts

## Decisions

## Action items
```

4. Reply with one short line confirming capture is live and where the file is — e.g. `📝 Capturing "Q3 Roadmap Sync" → ~/meeting-notes/2026-06-13-1030-q3-roadmap-sync.md`. Keep it to one line; the user is in a meeting.

## Phase 2 — Capture

Between start and wrap-up, **every** user message is meeting content unless it is clearly an end signal or an explicit command. Do not chat, summarize, or ask questions mid-meeting unless the user asks. For each message:

1. **Classify** each item into the right section, by intent rather than keyword:
   - **Notes** — general discussion, context, observations.
   - **Facts** — concrete data points, numbers, names, dates, commitments stated as true.
   - **Decisions** — anything resolved/agreed/chosen ("we decided", "going with", "approved").
   - **Action items** — things someone will do. Capture as `- [ ] <task> — **owner** (due: <when or "?">)`. Infer owner/due only if clearly stated; otherwise leave owner as `?` and `due: ?`.
   A single message may produce items in several sections. Split it accordingly.
2. **Append** each item to its section in the file using Edit (preserve everything already there — never rewrite the whole file from memory).
3. Reply with a **minimal** acknowledgement — a checkmark and, at most, the section(s) you filed it under (e.g. `✓ note + action`). No echoing back the full content. Speed and low noise matter more than confirmation here.

If the user explicitly corrects or retracts something ("scratch that", "change the owner to Mara"), edit the relevant line.

## Phase 3 — Wrap-up

Trigger: "meeting done", "wrap up", "end meeting", "/meeting done".

1. Read the current file in full.
2. Set **Status:** to `done` and append a wrap-up section to the file:

```markdown

## Summary
<3–6 sentence narrative of what happened and why it mattered.>

## Key decisions
<bulleted, each one self-contained.>

## Action items
- [ ] <task> — **owner** (due: <when>)
<consolidated and de-duplicated from the running list, owners/dues filled where known.>

## Open questions
<anything unresolved or flagged "?".>
```

3. **Publish the record as a pull request** (skip this whole step only in the no-git fallback). The goal is one branch + one PR per meeting, containing just this meeting's notes file:
   1. Find the default branch (usually `main`): `git remote show origin | grep 'HEAD branch'`, or assume `main`.
   2. Create a dedicated branch off the up-to-date default branch so the PR contains only the meeting note:
      ```bash
      git fetch origin <default>
      git checkout -b meeting-notes/YYYY-MM-DD-HHMM-<slug> origin/<default>
      ```
      The notes file is untracked, so it carries over to the new branch. If the checkout fails (e.g. conflicting tracked changes in the working tree), fall back to branching off the current HEAD: `git checkout -b meeting-notes/YYYY-MM-DD-HHMM-<slug>`.
   3. Stage **only** the meeting note (never `git add -A` — don't sweep in unrelated work) and commit:
      ```bash
      git add meeting-notes/YYYY-MM-DD-HHMM-<slug>.md
      git commit -m "Add meeting notes: <Title> (YYYY-MM-DD)"
      ```
   4. Push with upstream tracking, retrying on network errors with exponential backoff (2s, 4s, 8s, 16s):
      ```bash
      git push -u origin meeting-notes/YYYY-MM-DD-HHMM-<slug>
      ```
   5. Open a PR against the default branch. Prefer the GitHub MCP tool `create_pull_request` (title = `Meeting notes: <Title> (YYYY-MM-DD)`, body = the wrap-up summary + action items). If no GitHub MCP/`gh` access is available, push anyway and tell the user the branch is ready and they can open the PR manually.
4. Then post the **same wrap-up in chat** so the user can copy/paste it into email or a tracker immediately. Lead with the action items, since those are what people act on.
5. End with the file path **and the PR link** (or the branch name if the PR couldn't be created automatically) so they know where the full record lives.

## Conventions

- Times and dates are the user's **local** time. Get the real current time (`date`) rather than guessing.
- One meeting = one file = one branch = one PR. Multiple meetings the same day get distinct `HHMM` prefixes and slugs (and therefore distinct branches).
- Never delete past meeting files. To review history, list/Read under `<repo-root>/meeting-notes/`.
- During capture (Phase 2) the notes file stays uncommitted in the working tree on whatever branch is checked out — only Phase 3 creates the branch, commit, and PR. This keeps note-taking fast and non-disruptive to any other work in progress.
- If the user asks mid-session for "what do we have so far", Read the file and give a quick interim summary without changing Status.
