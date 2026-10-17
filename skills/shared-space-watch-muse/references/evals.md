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
