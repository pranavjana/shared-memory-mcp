# Dot watch evals

```json
{
  "skills": ["shared-space-watch-dot"],
  "query": "Watch Sandbox collaboration every 15 minutes and ping me in ChatGPT.",
  "expected_behavior": [
    "Uses list_spaces and that space name",
    "Saves a Dot recurring scheduled task, not a Grok routine or Muse /loop",
    "Does not subscribe to MCP Events or call notification_setup",
    "Does not treat plugin connect as a watch",
    "Runs a first tick now and tells the user to cancel in Scheduled"
  ]
}
```
