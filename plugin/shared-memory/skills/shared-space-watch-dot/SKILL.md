---
name: shared-space-watch-dot
description: >-
  ChatGPT Dot skill for Memspace: remember and recall, share into spaces,
  and a Scheduled recurring task that checks a space, or the user's own
  memories saved by their other assistants, every X minutes. Use only
  when this assistant is an OpenAI ChatGPT Dot (or Cloud Work as that dot),
  including Watch-tick wakes. Do not use on Muse, Grok Bot, or Cursor.
---

# Dot Memspace

You are **this ChatGPT Dot**. Memory ops and space watches both live in this skill. Do not load `shared-space-watch`, `shared-space-watch-tick`, Muse, or Grok skills.

## Phase

| Situation | Do |
| --- | --- |
| Remember / recall / share / one-off “what changed” | [references/operating-guide.md](references/operating-guide.md) |
| Start/change/stop a timed watch | Setup + Arm below |
| Prompt is a Watch tick | [references/tick.md](references/tick.md) — do not re-ask setup |

Examples, ontology, sharing, evals: [references/examples.md](references/examples.md), [ontology.md](references/ontology.md), [sharing-and-events.md](references/sharing-and-events.md), [evals.md](references/evals.md).

"Chat" means a Memspace **space** from `list_spaces`.

## Setup (watch)

```
- [ ] get_connection_status
- [ ] Scope: a space (list_spaces → which space) or personal
- [ ] Interval X minutes + time zone
- [ ] Recurring task saved
- [ ] User can see it in Scheduled
- [ ] First tick now
```

Ask scope/space if ambiguous. Ask X if missing (default **15**). Floor **5** (Free/Go may only allow daily — save the coarsest allowed). Cap **1440**. Deliver in **this Dot / ChatGPT conversation**. Notify only on new other-member updates (personal: new writes by other assistants).

**Personal watch** (no space): use when the user wants to know when their *other* assistants (or the dashboard) save or revise their own memories. Record `client.id` from `get_connection_status` as `selfClientId` so this assistant's own saves are skipped. Nobody else is involved; private memories stay private.

Watch settings live only in the schedule's payload. Never `remember`, `revise_memory`, or share watch settings, schedules, or seen lists — Memspace holds the user's knowledge, not watch state. Connecting the plugin is not a watch.

## Arm (this Dot only)

Save a recurring Scheduled task: payload below; every X minutes; named zone; optional end date. No MCP Events, `events/subscribe`, `notification_setup`, Slack/GitHub event tasks, or proactive-research as a substitute.

Confirm what was saved. Pausing the Dot does **not** cancel schedules — turn the task off in Scheduled. Run the tick **once now**. One task per `spaceId`, and at most one personal watch. Change = cancel old, then create new.

If this session cannot save a schedule: say so; on-demand `get_shared_update` (space) or `recall` (personal) only.

## Tick payload

```
Watch tick. Use skill shared-space-watch-dot.
host: dot
scope: space
spaceId: <id>
spaceName: <name>
intervalMinutes: <X>
```

Personal watch:

```
Watch tick. Use skill shared-space-watch-dot.
host: dot
scope: personal
selfClientId: <client.id from get_connection_status>
intervalMinutes: <X>
```

Then [tick.md](references/tick.md). Message **this user** here only.

## Stop

Cancel the Scheduled task; confirm it will not run.

## Honesty

Watch is running only if the Dot confirmed a saved schedule and the first tick ran. Plugin connected ≠ watching. Friend was never notified.
