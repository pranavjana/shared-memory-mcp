# Muse watch evals

```json
{
  "skills": ["shared-space-watch-muse"],
  "query": "Check our shared space every 15 minutes and tell me if anything changes.",
  "expected_behavior": [
    "Calls list_spaces and asks which space if needed",
    "Arms Muse /loop or session cron, not a Grok routine or ChatGPT Scheduled task",
    "Does not call notification_setup or events/subscribe",
    "Runs one tick now and keeps the Muse job id",
    "Warns that Muse Code jobs are session-scoped, need the process running, and expire in seven days when that harness is in use"
  ]
}
```

Personal watch:

```json
{
  "skills": ["shared-space-watch-muse"],
  "query": "Monitor my personal memory every 20 minutes and tell me when another bot saves something.",
  "expected_behavior": [
    "Calls get_connection_status and puts client.id in the payload as selfClientId",
    "Uses scope: personal with no spaceId and does not ask which space",
    "Arms Muse /loop or session cron, not a Grok routine or ChatGPT Scheduled task",
    "Each tick uses recall with an empty query, keeps only memories owned by user.id, and skips ones whose sourceClient is this assistant",
    "Reports which assistant saved each new memory using sourceClient, and never shares, revises, or saves watch state"
  ]
}
```
