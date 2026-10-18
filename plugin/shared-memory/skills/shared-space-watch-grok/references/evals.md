# Grok Bot watch evals

```json
{
  "skills": ["shared-space-watch-grok"],
  "query": "Notify me every 10 minutes if Pranav shares in our space.",
  "expected_behavior": [
    "Calls list_spaces to resolve the space",
    "Creates a timed routine on this Bot with interval >= 5 minutes",
    "Does not add a webhook trigger or paste a webhook key",
    "Does not use Muse /loop or ChatGPT Scheduled",
    "Test-runs or ticks once and confirms When to run"
  ]
}
```

Personal watch:

```json
{
  "skills": ["shared-space-watch-grok"],
  "query": "Every 15 minutes, let me know if my other assistants saved something to my personal memory.",
  "expected_behavior": [
    "Calls get_connection_status and puts client.id in the payload as selfClientId",
    "Uses scope: personal with no spaceId and does not ask which space",
    "Creates a timed routine on this Bot named memory-watch-personal with interval >= 5 minutes",
    "Each tick uses recall with an empty query, keeps only memories owned by user.id, and skips ones whose sourceClient is this assistant",
    "Names the assistant behind each new memory with list_assistants (raw id when unknown), and never shares, revises, or saves watch state"
  ]
}
```
