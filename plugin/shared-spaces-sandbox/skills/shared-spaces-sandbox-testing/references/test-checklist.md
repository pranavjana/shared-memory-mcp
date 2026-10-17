# Test while signed in as yourself

1. Sign into https://shared-memory-mcp-sandbox.up.railway.app/dashboard with `pranavjana2003@gmail.com` or your own developer email. This is a separate account from production even when the email matches. Use your ordinary sign-in flow; a demo test code is not a code for your real email.
2. Install/update Shared Spaces Sandbox and authorize its MCP with that same login. Keep the production plugin separate. Ask: **"Verify my signed-in email. Show my spaces and the Demo Teammate's updates in Sandbox collaboration. Do not save anything yet."**
3. In Shared spaces, open **Sandbox collaboration**. It should contain Demo Teammate's explicitly shared synthetic graph-import task and dashboard-review proposal. Private memories from either member must not appear in the space feed.

If fixtures are absent, ask a coding agent with authorized Railway access to preview and apply `scripts/sandbox-seed.mjs` in the sandbox service. The owner must already exist and have a verified primary email. Roshan uses `--owner-email <his-sandbox-email>`; each owner gets their own space and demo teammate. No demo login is required.

## Create a space and invite a friend

From Shared spaces, create a new named space, invite a friend's verified account email, and copy the invitation link. The friend opens it and accepts while signed in with that email. Creating an invitation does not itself grant access, send an email, or share private memories. Select memories explicitly to share; contributors share their own records and readers can only retrieve. For ordinary development use your prejoined Demo Teammate space; a coding agent can prepare synthetic memberships through the guarded operator.

## Share your own memory

Ask: **"Save 'Synthetic fixture: I finished testing the sandbox dashboard' as a task in project Sandbox Demo. Share only that record in my Sandbox collaboration space. Return the save/share receipts and IDs."**

Pass: your own identity is the author, the chosen space contains the record, and your other private notes stay outside its feed. Inspect automaticShares because user-enabled rules can affect saves. A share is not evidence a recipient agent ran.

## Read and author permissions

The operator receipt includes ownPrivateId, demoPrivateId, demoSharedIds, and space.id. Retrieve a shared ID as yourself; it should work. Retrieve demoPrivateId; not-found/permission denied is the expected pass. Explicitly request a revision to the demo author's source; it must fail even though you own the space. Revise your own record using its current expectedRevision; that should work. Do not reconstruct inaccessible content from chat history. The reverse private boundary is verified by the operator/integration tests without a demo login.

## Receive a demo update

Ask your coding agent: **"In Railway sandbox only, simulate an incoming update from my demo teammate with the guarded fixture command. Keep me signed in as myself, use a stable retry key, and return the update ID."**

Inside the sandbox service the operator uses `npm run sandbox:seed -- --demo-update demo-progress-001 --apply`. Choose a new key for each requested update and reuse it for retries; add --owner-email for another developer. Ask the plugin to retrieve the returned demoUpdateId. Pass: it is visible as a synthetic demo-authored update. This is simulated fixture activity, not an actual external agent or notification.

## Retraction and revocation

Retract one of your own shared records with share_memory enabled=false. It disappears from the space feed; you still retain author access to the private source. The operator/tests verify the teammate loses shared access.

As the space owner, use View members → Revoke access for Demo Teammate. The operator/tests must find that teammate membership and its read access to your shared records are denied. Your own access to earlier demo-shared content remains while those shares are active. Ordinary seeds preserve revoked/changed membership; an explicit --restore-demo-membership --apply issues and accepts a fresh synthetic invitation when you want to resume demo activity.

Cleanup only selected synthetic records on request; do not reset the database or other developers' spaces.

## Selected-claim retrieval

Request a fresh incoming demo update through the guarded operator, keeping your own account. For a selected claim, fetch its publication ID through `get_shared_update` in the exact space; the private source must remain inaccessible. Retractions and revoked access must stop retrieval; never repeat withdrawn content from an earlier read.

## Shared-updates inbox

Request a fresh incoming demo update, then ask: **"Anything new from my spaces?"** Pass: `check_inbox` returns the update as a short preview with the demo teammate as author; ask again and it is gone after `mark_inbox_seen`. Ask an unrelated memory question while an update is unread; the tool result carries an `inbox` footer and the agent mentions it. Your own shares never appear in your inbox; private and retracted records never do.

## About you and timing

Have a teammate share a record that contains your first name. Pass: it is listed first with `aboutYou.status = possible`; answer "is this you?" and `confirm_identity` makes it `confirmed`. Check `get_notification_preferences`, confirm your timezone, then compare `dueNow` for mentions (instant) and other updates (held for the digest at `nextDigestAt`; instant in `all` mode; nothing during quiet hours).

## Lookouts

From the dashboard's Assistants page copy the host prompt (or call `assistant_setup`). Grok Bot: the Bot creates a "When a webhook fires" routine; paste its URL and Authorization header into the dashboard, press Send test, and confirm the Bot messages you. Muse: the agent calls `create_pulse_link` and creates a hook (or a 15-minute fallback schedule); record which one. Dot: confirm the schedule it created. For each host, record the delay between a due share and the user-visible message. A ring, a pulse change or a scheduled run is not evidence that the user was told; only the message is.
