---
name: shared-space-watch-muse
description: >-
  Meta Muse skill for Memspace: remember and recall, share into spaces,
  and a Muse /loop or session cron that checks a space, or the user's own
  memories saved by their other assistants, every X minutes. Use
  only when this assistant is Muse (personal Muse or Muse Code), including
  Watch-tick wakes. Do not use on Grok Bot, ChatGPT Dot, or Cursor.
---

# Muse Memspace

You are **Muse**. Memory ops and space watches both live in this skill. Do not load `shared-space-watch`, `shared-space-watch-tick`, Grok, or Dot skills.

## Phase

| Situation | Do |
| --- | --- |
| Remember / recall / share / one-off “what changed” | [references/operating-guide.md](references/operating-guide.md) |
| Start/change/stop a timed watch | Setup + Arm below |
| Prompt is a Watch tick | [references/tick.md](references/tick.md) — do not re-ask setup |

Examples, ontology, sharing detail, evals: [references/examples.md](references/examples.md), [ontology.md](references/ontology.md), [sharing-and-events.md](references/sharing-and-events.md), [evals.md](references/evals.md).

"Chat" means a Memspace **space** from `list_spaces`.

## Setup (watch)

```
- [ ] get_connection_status
- [ ] Scope: a space (list_spaces → which space) or personal
- [ ] Interval X minutes
- [ ] Muse job armed (same session)
- [ ] First tick now
```

Ask scope/space if ambiguous. Ask X if missing (default **15**). Floor **5**, cap **1440**.

**Personal watch** (no space): use when the user wants to know when their *other* assistants (or the dashboard) save or revise their own memories. Record `client.id` from `get_connection_status` as `selfClientId` so this assistant's own saves are skipped. Nobody else is involved; private memories stay private.

Watch settings live only in the job's payload. Never `remember`, `revise_memory`, or share watch settings, jobs, or seen lists — Memspace holds the user's knowledge, not watch state.

## Arm (Muse only)

Do not create a Grok routine, ChatGPT Scheduled task, Cursor `/loop`, or Memspace webhook.

1. One recurring job whose task is the payload below (`/loop every <X> minutes, …` on Muse Code, or this Muse VM cron).
2. Local timezone. Run the tick **once now** without a second job.
3. Keep the **job ID**. Same session must stay resumable.

Gotchas: session-scoped; Muse Code must be **running**; recurring jobs **expire in seven days** (cancel+recreate); ~30m jitter; at most one catch-up after resume; cancel by ID to change; no lifecycle hooks.

No `/loop`/cron → say so; on-demand `get_shared_update` (space) or `recall` (personal) only.

## Tick payload

```
Watch tick. Use skill shared-space-watch-muse.
host: muse
scope: space
spaceId: <id>
spaceName: <name>
intervalMinutes: <X>
```

Personal watch:

```
Watch tick. Use skill shared-space-watch-muse.
host: muse
scope: personal
selfClientId: <client.id from get_connection_status>
intervalMinutes: <X>
```

Then [tick.md](references/tick.md). Message **this Muse user** only.

## Stop

Cancel the job by ID; list jobs to confirm.

## Honesty

Watch is running only if a job id exists and the first tick ran. Friend was never notified. Muse Code does not watch while the process is closed or after expiry.
