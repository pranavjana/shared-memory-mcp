# Manual sandbox test

Use only https://shared-memory-mcp-sandbox.up.railway.app/dashboard and the Shared Spaces Sandbox plugin. The original Shared Memory plugin still targets production. Do not select both plugins for this test.

## 1. Connect as Alice

Install the private Shared Spaces Sandbox plugin from its saved plugin page and authorize its MCP connection. In Clerk choose `alice+clerk_test@example.com`, then email code `424242`. If Clerk has selected Pranav or another user, sign out of the sandbox Clerk session or choose another account before authorizing. Do not change production Clerk sessions to do this.

Select this plugin in a chat and paste:

> Use only Shared Spaces Sandbox. Call get_connection_status and list_spaces. Confirm I am alice+clerk_test@example.com and owner of Shared Spaces Sandbox. Do not save or share anything yet.

Pass: the tools return Alice's actual email and owner role. Stop if another identity is returned. If the fixture space is missing, check the sandbox dashboard; do not invent a space or silently choose a different one.

## 2. Write two records, sharing only one

Paste as Alice:

> In the sandbox only, create a new synthetic private fact: "Synthetic fixture: Alice's private demo marker is copper-otter." Then create a separate synthetic task update: "Synthetic fixture: Alice completed the sandbox demo checklist." Use entity project Sandbox Demo for both. Share only the task update in Shared Spaces Sandbox. Return the private memory ID, shared memory ID, space ID, and the actual save/share receipts. Keep the private marker private.

Choose fresh operation keys for this run; reuse them for retries. Inspect `automaticShares` in save receipts. Existing user-enabled rules can affect what is shared: if a rule unexpectedly shares the private fixture, report a failed privacy setup and ask the user to disable the relevant sandbox rule before creating a fresh private fixture. Do not claim privacy merely because the first save is private by default.

Save the three returned IDs outside the chat for later prompts. The dashboard should show both records for Alice. In a separate browser profile, log into the sandbox dashboard as Bob; the task update should appear through the shared space, and the private record should be absent. This tests the recipient UI without changing the agent's Alice connection.

## 3. Retrieve as Bob in a clean chat

Reconnect the sandbox plugin and authorize `bob+clerk_test@example.com` with code `424242`. Start a new chat, select only this plugin, and paste the IDs, not Alice's private contents:

> Use only Shared Spaces Sandbox. Verify my account is bob+clerk_test@example.com. Retrieve shared memory ID SHARED_ID using get_memory. Then try private memory ID PRIVATE_ID. Report the actual results; a not-found/permission error for the private ID is the expected pass. Do not answer from another chat or cached text.

Pass: Bob retrieves the shared update; the private ID returns an access/not-found error. Confirm Bob's membership is contributor. For an author-only correction test, explicitly ask Bob to revise Alice's shared record: it must fail, and the source revision must remain unchanged.

## 4. Corrections and revocation

Reconnect as Alice and verify identity. Ask to revise the shared update to "Synthetic fixture: Alice completed the sandbox demo checklist and verification." Use `get_memory` for the current revision before `revise_memory`; retain evidence and use the current expectedRevision. Reconnect as Bob, verify identity, and retrieve the same ID. Pass: Bob sees the new current revision, while author-only historic evidence remains unavailable to him.

For retraction, reconnect as Alice and explicitly request `share_memory` for the same memory/space with enabled=false and a new operation key. Reconnect as Bob and call `get_memory` for that ID. Pass: it is no longer retrievable. This stops future service access; already displayed chat text does not disappear.

For membership revocation instead, keep a fresh record actively shared. Log into the dashboard as Alice, open Shared spaces, open the space's members, and revoke Bob. With Bob still authorized, retrieve the record again. Pass: access is denied and the space is absent from `list_spaces`. Bob needs a fresh Alice-issued invitation and acceptance to join again; an old accepted link cannot restore revoked membership.

## 5. Outsider test

Reconnect as `eve+clerk_test@example.com`, verify identity, and call `list_spaces` and `get_memory` with the shared ID. Eve should have no membership in Shared Spaces Sandbox and cannot retrieve the record even while it is shared with Alice and Bob. Unexpected later invitations must be considered when assessing this result.

## 6. Proactive notification test is separate

First complete ordinary sharing and recipient retrieval. On a host that supports the server's MCP event protocol, connect Bob and explicitly ask to monitor `memory.changed` for the returned space ID. Confirm a real subscription receipt before Alice shares a new update. Bob's agent must retrieve current authorized content and message Bob. A share receipt or accepted webhook alone is not proof of a user-visible notification. If the host has no event subscription capability, mark this test unsupported; on-demand retrieval can still pass.

Do not automatically reply from Bob to Alice, start polling, or claim a background monitor exists without the user's request and a supported host capability.

## Cleanup

Ask for cleanup explicitly. Each author can forget their own synthetic records by ID. Restore Bob through a new invitation when needed, or create a fresh space. This plugin has no database reset or administrator bypass. A server-side fixture seed is documented in the repository's docs/development.md and does not erase experiments.
