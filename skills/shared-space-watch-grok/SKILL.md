---
name: shared-space-watch-grok
description: >-
  Grok Bot skill for Shared Memory: remember and recall, share into spaces,
  and a timed routine on this Bot that checks a space, or the user's own
  memories saved by their other assistants, every X minutes. Use
  only when this assistant is an xAI Grok Bot, including Watch-tick routine
  runs. Do not use on Muse, ChatGPT Dot, or Cursor.
---

# Grok Bot Shared Memory

You are **this Grok Bot**. Memory ops and space watches both live in this skill. Do not load `shared-space-watch`, `shared-space-watch-tick`, Muse, or Dot skills.

## Phase

| Situation | Do |
| --- | --- |
| Remember / recall / share / one-off “what changed” | [references/operating-guide.md](references/operating-guide.md) |
| Start/change/stop a timed watch | Setup + Arm below |
| Prompt is a Watch tick | [references/tick.md](references/tick.md) — do not re-ask setup |

Examples, ontology, sharing, evals: [references/examples.md](references/examples.md), [ontology.md](references/ontology.md), [sharing-and-events.md](references/sharing-and-events.md), [evals.md](references/evals.md).

"Chat" means a Shared Memory **space** from `list_spaces`.

## Setup (watch)

```
- [ ] get_connection_status
- [ ] Scope: a space (list_spaces → which space) or personal
- [ ] Interval X minutes (Grok minimum 5)
- [ ] Routine on this Bot
- [ ] When to run + time zone confirmed
- [ ] Test or first tick
```

Ask scope/space if ambiguous. Ask X if missing (default **15**). **≥ 5 minutes apart.** Cap **1440**. Zone = this Bot unless they name one.

**Personal watch** (no space): use when the user wants to know when their *other* assistants (or the dashboard) save or revise their own memories. Record `client.id` from `get_connection_status` as `selfClientId` so this assistant's own saves are skipped. Nobody else is involved; private memories stay private.

Watch settings live only in the routine's payload. Never `remember`, `revise_memory`, or share watch settings, routines, or seen lists — Shared Memory holds the user's knowledge, not watch state.

## Arm (this Bot only)

Schedule only. Shared Memory does not POST to Grok webhooks. Never paste a webhook key.

Create one routine this Bot owns, name `space-watch-<spaceName>` (personal: `memory-watch-personal`):

- When: every X minutes
- Instruction: payload below; post in **this conversation**; only other-member updates (personal: only other-assistant writes); never contact the sender
- No Slack/GitHub/every-message/webhook triggers

Confirm next run. **Test run** once (real MCP reads). User manages Routines in conversation details. Laptop-closed is true only after the routine exists. Max 50 routines; delete has no undo; long absence may pause.

Change: delete/pause old routine, then replace. Cannot create routines → say so; on-demand reads only.

## Tick payload

```
Watch tick. Use skill shared-space-watch-grok.
host: grok
scope: space
spaceId: <id>
spaceName: <name>
intervalMinutes: <X>
```

Personal watch:

```
Watch tick. Use skill shared-space-watch-grok.
host: grok
scope: personal
selfClientId: <client.id from get_connection_status>
intervalMinutes: <X>
```

Then [tick.md](references/tick.md). Post only here.

## Stop

Pause or delete that routine; confirm it will not run.

## Honesty

Watch is running only if the routine exists, is not paused, When to run matches X, and a test/first tick ran. Friend was never notified.
