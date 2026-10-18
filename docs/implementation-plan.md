# Memspace implementation plan

This is the original approved scope, written when the product was called Shared Memory. Notes in *italics* record what changed since.

Approved scope: personal ontology memory across assistants and permissioned sharing between people. Assistants save explicit statements and observed outcomes without repetitive approvals, acknowledge successful saves naturally, and use a provided operating skill. The dashboard provides source details, revisions, connections, and access controls.

## Memory model

A Memory belongs to its author and links to revisions and typed entities. Supported kinds are fact, preference, event, goal, task, decision, and relationship. Entities represent people, projects, organizations, places, and topics. Sources include the authenticated client identity and a supplied evidence excerpt; an excerpt is evidence supplied by the client, not independent verification. Event time and record time remain separate. Revisions use compare-and-swap and retry keys. Old revisions remain available to their owner until deletion.

A private graph stores account profiles. The application graph stores Memory, Revision, Entity, Space, Membership, Invitation, and Change nodes. Backend authorization scopes every read, graph expansion, and write. Private memories are visible only to their owner unless actively shared in a space accessible to the reader. Shared memories reference the source and current revision. Revocation stops future retrieval. Previously retrieved content cannot be recalled from another assistant's conversation.

## Sharing

A space owner invites a registered user's verified primary email. An invitation is accepted by that signed-in user and grants reader or contributor access. The owner can revoke membership. Sharing requires a contributor grant and explicit intent from the user or a matching enabled rule. New shares and source revisions record durable Change entries; members retrieve shared updates on demand with permission checks on every read.

There is no automatic reply to the sender. Connecting as friends does not reveal private memory. Webhook-based proactive delivery (MCP Events) was removed. *Members' agents now pick up updates automatically through a scheduled watch in each host (the `shared-space-watch-*` skills).*

## Host integration

Retain the existing 2025 MCP endpoint alongside the stateless 2026-07-28 discovery and tool surface. Automatic memory invocation requires real host acceptance tests.

## Acceptance

Test two isolated users; save and recall across authenticated clients; retrieve related context through entity edges; correct with history; reject stale revisions and foreign writes; deduplicate replayed requests; accept scoped invitations; share and retract references; revoke membership; recover records after restart.

The private personal plugin is `plugins_6ad00b37b7148191a76953dc3d1bcad0`, release `pluginrel_6ad00b389b148191a823835aaba6f081`, version `0.2.0`. Its stored MCP configuration and operating skill were inspected after creation. Installation and OAuth connection remain host acceptance steps; account creation alone does not establish them.

## Later proactive memory management

Background reconciliation, inferred patterns, contradiction detection, confidence calibration, and memory aging follow V1. V1 does not promote model guesses into facts or silently widen sharing permissions. *Server-side claim extraction on save has since been added (see [ontology.md](ontology.md#automatic-structuring-on-save)); the other items here are not built.*
