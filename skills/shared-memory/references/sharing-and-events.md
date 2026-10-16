# Sharing and event monitoring

Load when the user asks to share/retract a memory, enable monitoring, or when a `memory.changed` or `knowledge.changed` event arrives.

## Contents

- Share and retract
- Automatic sharing rules
- Subscribe and renew
- On event delivery
- Receipt semantics

## Share and retract

1. Call `list_spaces` and identify the intended space and recipient.
2. Check the user’s role (readers retrieve; contributors/owners share their own memories).
3. Save only the intended update if needed (`remember`).
4. Call `share_memory` with `userRequested: true`, `enabled: true`, and a stable `idempotencyKey`.
5. To retract: `share_memory` with `enabled: false` for that space (same idempotency discipline on retries).
6. Ask if the recipient or space is ambiguous. If no authorized space exists, direct the user to create or join one in the dashboard.

Do not claim to write into another person’s private memory, copy a private graph, create a space through a nonexistent tool, or make commitments for someone else. Changes to a shared source become visible on the next authorized read. Neither forgetting nor retraction can erase copies another host already received. Stopping a sharing rule does not retract previous shares.

Selected ontology assertions use `publish_claim` (not whole-memory `share_memory`). Publications queue `knowledge.changed` for active space subscribers; a publication receipt is a queued update, not proof of agent notification.

## Automatic sharing rules

A private save may trigger an existing dashboard-enabled rule. Inspect `automaticShares` in the receipt and acknowledge actual sharing. Friendship, invitation, connection, or space membership alone is not permission to share every relevant memory.

## Subscribe and renew

When the user asks to monitor an authorized shared space:

1. Call `notification_setup` for space-specific Muse or Dot instructions. Setup instructions do **not** activate monitoring.
2. Confirm the host supports real event subscriptions (do not invent a tool).
3. Subscribe to **both** `memory.changed` and `knowledge.changed`, filtered by `space_id`.
4. Record a successful subscription and its expiry.
5. Renew only within the user’s authorized monitoring request and the host’s capabilities.
6. Stop when monitoring is canceled, permissions are revoked, or renewal fails.

Do not claim a normal chat is running in the background. Native Dot/Cloud Work supports MCP Events; Muse requires verification of an actual persistent callback and wake-up capability. Never silently substitute a polling schedule for a webhook.

## On event delivery

1. Deduplicate by event ID.
2. Call `get_shared_update` with the event’s `space_id` as `spaceId` and its `memory_id` (`memory.changed`) or `publication_id` (`knowledge.changed`) as `id` to retrieve the current authorized update and related context restricted to that same space. Do not trust the stale payload alone.
3. Notify **your own** user about the current update, author, and relevant context (e.g. Roshan’s agent tells Roshan that Pranav completed a task).
4. Do not automatically reply to the sender or echo the update into another memory or webhook loop.
5. Do not reconstruct forgotten, retracted, or inaccessible content from an old event.
6. Do not retrieve a private source ID for a selected claim, even if another tool can access it in a different scope.
7. Handle revisions and out-of-order or duplicate events using current state.

## Receipt semantics

| Receipt | Means |
| --- | --- |
| Share / publish receipt | A shared reference or selected-claim publication was created or updated (queued for subscribers) |
| Subscription receipt | Monitoring registration succeeded (note expiry) |
| Accepted webhook | The host acknowledged delivery — not that an assistant ran or messaged a user |

Never collapse these into “your friend was notified.” If host events are unavailable, offer an on-demand check and state that limitation. Persistent background inference, autonomous cross-person commitments, and unrestricted proactive memory management are outside this V1 workflow.
