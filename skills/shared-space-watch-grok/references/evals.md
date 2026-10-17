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
