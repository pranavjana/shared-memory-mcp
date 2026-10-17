# Sharing and shared updates

Load when the user asks to share/retract a memory or to read an update shared in a space.

## Contents

- Share and retract
- Automatic sharing rules
- Read a shared update
- Receipt semantics

## Share and retract

1. Call `list_spaces` and identify the intended space and recipient.
2. Check the user’s role (readers retrieve; contributors/owners share their own memories).
3. Save only the intended update if needed (`remember`).
4. Call `share_memory` with `userRequested: true`, `enabled: true`, and a stable `idempotencyKey`.
5. To retract: `share_memory` with `enabled: false` for that space (same idempotency discipline on retries).
6. Ask if the recipient or space is ambiguous. If no authorized space exists, direct the user to create or join one in the dashboard.

Do not claim to write into another person’s private memory, copy a private graph, create a space through a nonexistent tool, or make commitments for someone else. Changes to a shared source become visible on the next authorized read. Neither forgetting nor retraction can erase copies another host already received. Stopping a sharing rule does not retract previous shares.

Selected ontology assertions use `publish_claim` (not whole-memory `share_memory`). A publication receipt confirms the snapshot was published, not that anyone was notified.

## Automatic sharing rules

A private save may trigger an existing dashboard-enabled rule. Inspect `automaticShares` in the receipt and acknowledge actual sharing. Friendship, invitation, connection, or space membership alone is not permission to share every relevant memory.

## Read a shared update

Shared Memory does not push to other members’ agents. A chat left open is not a monitor.

1. Call `get_shared_update` with the space ID as `spaceId` and the memory ID or publication ID as `id` to retrieve the current authorized update and related context restricted to that same space.
2. Tell **your own** user about the current update, author, and relevant context (e.g. Roshan’s agent tells Roshan that Pranav completed a task).
3. Do not automatically reply to the sender or echo the update into another memory.
4. Do not reconstruct forgotten, retracted, or inaccessible content from an earlier read.
5. Do not retrieve a private source ID for a selected claim, even if another tool can access it in a different scope.

For a user-requested check every X minutes, use this host skill’s Arm section and [tick.md](tick.md). Do not invent webhooks.

## Receipt semantics

| Receipt | Means |
| --- | --- |
| Share / publish receipt | A shared reference or selected-claim publication was created or updated — not that another member or agent was notified |

Never collapse this into “your friend was notified.” Offer an on-demand check instead. Persistent background inference, autonomous cross-person commitments, and unrestricted proactive memory management are outside this V1 workflow.
