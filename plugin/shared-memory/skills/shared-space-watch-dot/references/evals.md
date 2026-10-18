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

Personal watch:

```json
{
  "skills": ["shared-space-watch-dot"],
  "query": "Also tell me every 30 minutes if Codex or my other assistants save anything to my memory.",
  "expected_behavior": [
    "Calls get_connection_status and puts client.id in the payload as selfClientId",
    "Uses scope: personal with no spaceId and does not ask which space",
    "Saves a Dot recurring scheduled task, not a Grok routine or Muse /loop",
    "Each tick uses recall with an empty query, keeps only memories owned by user.id, and skips ones whose sourceClient is this assistant",
    "Names the assistant behind each new memory with list_assistants (raw id when unknown), and never shares, revises, or saves watch state"
  ]
}
```
