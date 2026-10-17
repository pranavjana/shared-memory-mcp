# Shared Memory implementation plan

Approved scope: personal ontology memory across assistants and permissioned sharing between people. Assistants save explicit statements and observed outcomes without repetitive approvals, acknowledge successful saves naturally, and use a provided operating skill. The dashboard provides source details, revisions, connections, access controls, and delivery status.

## Memory model

A Memory belongs to its author and links to revisions and typed entities. Supported kinds are fact, preference, event, goal, task, decision, and relationship. Entities represent people, projects, organizations, places, and topics. Sources include the authenticated client identity and a supplied evidence excerpt; an excerpt is evidence supplied by the client, not independent verification. Event time and record time remain separate. Revisions use compare-and-swap and retry keys. Old revisions remain available to their owner until deletion.

A private graph stores account profiles. The application graph stores Memory, Revision, Entity, Space, Membership, Invitation, Subscription, Event, and Delivery nodes. Backend authorization scopes every read, graph expansion, write, and event delivery. Private memories are visible only to their owner unless actively shared in a space accessible to the reader. Shared memories reference the source and current revision. Revocation stops future retrieval and deliveries. Previously delivered content cannot be recalled from another assistant's conversation.

## Sharing and notifications

A space owner invites a registered user's verified primary email. An invitation is accepted by that signed-in user and grants reader or contributor access. The owner can revoke membership. Sharing requires a contributor grant and explicit intent from the user or a matching enabled rule. New shares and source revisions generate durable events for the receiving members. A worker verifies signed HTTPS callbacks, retries transient delivery failures with stable event IDs, and checks permissions before each attempt. HTTP acceptance is distinct from a completed recipient agent run.

The intended flow is Pranav requests sharing, a scoped memory update commits, a webhook wakes Roshan's subscribed agent, and that agent retrieves current context and messages Roshan. There is no automatic reply to Pranav. Connecting as friends does not reveal private memory. Backend notices and dashboard traces never claim an agent responded without evidence.

## Host integration

Retain the existing 2025 MCP endpoint and add the stateless 2026-07-28 discovery, tool, and event surface described in https://developers.openai.com/plugins/build/mcp-events . Persistent subscriptions, callback challenge verification, address validation, encryption at rest for signing secrets, and Standard Webhooks signatures are required. Dot subscription and automatic memory invocation require real host acceptance tests. Muse remains a separate compatibility milestone.

## Acceptance

Test two isolated users; save and recall across authenticated clients; retrieve related context through entity edges; correct with history; reject stale revisions and foreign writes; deduplicate replayed requests; accept scoped invitations; share and retract references; revoke membership; prevent unauthorized or duplicate event deliveries; reject private-network callbacks; recover subscriptions and records after restart. Verify a real dot run separately from simulated callback acceptance.

The private personal plugin is `plugins_6ad00b37b7148191a76953dc3d1bcad0`, release `pluginrel_6ad00b389b148191a823835aaba6f081`, version `0.2.0`. Its stored MCP configuration and operating skill were inspected after creation. Installation, OAuth connection, and live event discovery remain host acceptance steps; account creation alone does not establish them.

For the real host test, install/connect the plugin and rescan until the memory tools and `memory.changed` event appear. Create an explicitly shared space in the dashboard and have each member connect their own account. In the receiving member's dot or cloud Work chat, request: "Monitor memory.changed for space SPACE_ID. When another member shares an update, retrieve the current memory and tell me who shared it and what changed. Do not message the sender or share my private context." Confirm an active subscription in Connections before publishing a selected synthetic update from the sender's account. Verify both an accepted delivery in Activity and the recipient's actual message, then stop monitoring and confirm the subscription stops. Do not claim the recipient agent ran from a webhook receipt alone.

## Later proactive memory management

Background reconciliation, inferred patterns, contradiction detection, confidence calibration, and memory aging follow V1. V1 does not promote model guesses into facts or silently widen sharing permissions.
