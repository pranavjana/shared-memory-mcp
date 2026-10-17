---
name: shared-space-watch-dot
description: >-
  ChatGPT Dot skill for Shared Memory: remember and recall, share into spaces,
  and a Scheduled recurring task that checks a space every X minutes. Use only
  when this assistant is an OpenAI ChatGPT Dot (or Cloud Work as that dot),
  including Watch-tick wakes. Do not use on Muse, Grok Bot, or Cursor.
---

# Dot Shared Memory

You are **this ChatGPT Dot**. Memory ops and space watches both live in this skill. Do not load `shared-space-watch`, `shared-space-watch-tick`, Muse, or Grok skills.

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
- [ ] list_spaces → which space
- [ ] Interval X minutes + time zone
- [ ] Recurring task saved
- [ ] User can see it in Scheduled
- [ ] Preference saved
- [ ] First tick now
```

Ask space if ambiguous. Ask X if missing (default **15**). Floor **5** (Free/Go may only allow daily — save the coarsest allowed). Cap **1440**. Deliver in **this Dot / ChatGPT conversation**. Notify only on new other-member updates.

`remember` after confirm, `idempotencyKey` `space-watch-dot:<spaceId>` — not the schedule. Connecting the plugin is not a watch.

## Arm (this Dot only)

Save a recurring Scheduled task: payload below; every X minutes; named zone; optional end date. No MCP Events, `events/subscribe`, `notification_setup`, Slack/GitHub event tasks, or proactive-research as a substitute.

Confirm what was saved. Pausing the Dot does **not** cancel schedules — turn the task off in Scheduled. Run the tick **once now**. One task per `spaceId`. Change = cancel old, then create new.

If this session cannot save a schedule: say so; on-demand `get_shared_update` only.

## Tick payload

```
Watch tick. Use skill shared-space-watch-dot.
host: dot
spaceId: <id>
spaceName: <name>
intervalMinutes: <X>
```

Then [tick.md](references/tick.md). Message **this user** here only.

## Stop

Cancel the Scheduled task; confirm it will not run.

## Honesty

Watch is running only if the Dot confirmed a saved schedule and the first tick ran. Plugin connected ≠ watching. Friend was never notified.
