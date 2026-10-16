# Shared Memory

A personal ontology memory service for connected assistants, with a Clerk-authenticated dashboard and FalkorDB persistence. Assistants can save explicit statements and observed outcomes, recall related context, correct memories with history, and share selected references into permissioned spaces.

Dashboard: https://shared-memory-mcp-production.up.railway.app/dashboard

MCP: https://shared-memory-mcp-production.up.railway.app/mcp

## Connect an assistant

Create an account in the dashboard. In Connections, add the MCP URL to your assistant using Streamable HTTP and OAuth, then sign in with the same account. Connecting grants the client access to that account's memory tools; individual clients can be revoked in Connections.

OAuth requirements (do not weaken these) — working Muse / public-client shape:

| Parameter | Value |
|-----------|--------|
| MCP resource | exactly `https://shared-memory-mcp-production.up.railway.app/mcp` |
| `resource=` | required on **authorize and token** (and retained on refresh); RFC 8707 |
| Working scopes | `openid profile email offline_access` (service minimum is `profile email`; Muse needed all four for OIDC/refresh) |
| Public client auth | PKCE `S256`, `token_endpoint_auth_method: none` (no client secret) |
| DCR | use `registration_endpoint` from **oauth-authorization-server** metadata (prod: `https://organic-buck-9271.clerk.accounts.dev/oauth/register`) |

Client registration:

- **Do use DCR** when Clerk advertises `registration_endpoint` on OAuth authorization-server metadata (`/.well-known/oauth-authorization-server`). Production register URL: `https://organic-buck-9271.clerk.accounts.dev/oauth/register`. OIDC discovery (`/.well-known/openid-configuration`) may **omit** `registration_endpoint` — do not conclude “no DCR” from OIDC alone; read AS metadata (or use the documented register URL).
- CIMD is also fine when `client_id_metadata_document_supported` is true. Leave manually entered client ID and secret blank for DCR/CIMD.
- If the host cannot use DCR/CIMD, register a **public** OAuth application in the Clerk Dashboard (see below) and configure the host with that client ID only (no secret).

A 401 `invalid_token` / audience mismatch means the access token was not bound to this MCP URL (usually missing DCR and/or missing `resource=`). That is a client configuration error, not host admin policy. On 401/403, check DCR, `resource=`, audience, and scopes first; do not blame workspace policy until those are correct. Reconnect with DCR + `resource=` + `openid profile email offline_access` rather than broadening unrelated scopes alone.

For ChatGPT users, open [ChatGPT Plugins](https://chatgpt.com/plugins), choose **+ → Add custom MCP server**, enter the endpoint and OAuth settings, create and install the plugin, then authorize the connection. Availability depends on the host's workspace permissions. Select the installed plugin with `@` in a chat.

The owner account can install the existing private [Shared Memory plugin](https://chatgpt.com/plugins/plugins_6ad00b37b7148191a76953dc3d1bcad0). It bundles the operating skill and Railway MCP connection. This USER-scoped private link is not a public install link for other accounts. Public directory distribution requires submission and review. Saving or updating a plugin does not itself install it or authorize its server.

Use **Copy MCP install prompt** in Connections step 1 to ask an agent to configure the MCP with the working recipe (DCR + `resource=` + `openid profile email offline_access`), then verify the signed-in account. `/setup/prompt` serves this connection-only request. It explicitly excludes skill installation, memory writes, sharing, and monitoring. If the host cannot manage MCP settings, the agent must provide manual steps and report installation as pending.

Step 2 installs the operating skill separately. `/skill`, the skill download, and `memory_instructions` expose the canonical `skills/shared-memory/SKILL.md`. The guide is also included in `plugin/shared-memory/skills/shared-memory/SKILL.md`; keep both copies identical when releasing a plugin update.

For reuse across chats, install the bundled skill or save the guide in the host's supported persistent instructions. A prompt pasted into one chat does not establish cross-chat persistence, bypass host approvals, or guarantee background monitoring. A host must actually invoke tools; connecting does not ingest entire chats or guarantee automatic saves.

Ask the assistant to remember a stated preference, then ask another connected assistant to recall it. A successful save returns a receipt. The assistant can acknowledge it conversationally; the dashboard contains source details, entity connections and revisions.

## Memory and graph model

`Person -[:AUTHORED]-> Memory -[:HAS_REVISION]-> Revision` tracks ownership and changes. `Memory -[:ABOUT]-> Entity` connects people, projects, organizations, places and topics. Memory kinds are fact, preference, event, goal, task, decision and relationship. Evidence excerpts and authenticated client attribution are retained; an agent-reported outcome is not independently verified by this service. Event time and recorded time are separate.

Retrieval combines authorized keyword/entity matches with native graph expansion through shared entities and shared spaces. Related context can be returned even without keyword overlap. V1 does not generate embeddings or promote inferred guesses into established facts. Background inference, reconciliation and memory aging are later milestones.

Writes use parameterized Cypher, unique constraints, deterministic retry IDs and compare-and-swap revisions. Author-only revision history prevents private historic versions leaking through a newly shared reference. Forgetting removes text, evidence and revision contents, withdraws shares and removes orphan entity records; minimal IDs and operational delivery metadata remain.

## Shared spaces and permissions

A space owner creates a reader or contributor invitation addressed to a verified primary email. The invited person accepts while signed in with that email. Contributors can share their own memories; they cannot edit somebody else's source memory. Owners can revoke members. Existing accepted invitation links cannot reactivate revoked access; a new invitation is required.

A shared reference uses `Memory -[:SHARED_IN {active:true}]-> Space <-[:MEMBER_OF {active:true}]- Person`. Each read, graph expansion and webhook delivery checks current access. Source corrections appear on the next read. Retraction stops future retrieval; content already received by another host cannot be recalled.

Sharing happens on an explicit request or through a dashboard-enabled rule matching a memory kind and optional entity name. Rules apply to future saves, do not backfill existing memories, and stop when disabled or permission is lost. Stopping a rule does not retract earlier shares.

## Proactive events

The same authenticated endpoint implements stateless `2026-07-28` discovery and tools alongside legacy MCP `2025-11-25` support. `events/list`, `events/subscribe` and `events/unsubscribe` expose `memory.changed`, filtered by `space_id`.

Ask a supported OpenAI dot or cloud Work chat to monitor an authorized space and notify its own user. The intended flow is: Pranav shares an update; Roshan's subscribed agent retrieves current context and messages Roshan. No automatic response to Pranav is required.

Subscriptions persist in FalkorDB and expire no later than their authorizing access token; the host must refresh them. Signing secrets and authorizing tokens are encrypted using AES-256-GCM. The worker rechecks client revocation, OAuth authorization and space access. It verifies signed callback challenges and pins validated public DNS addresses for each HTTPS connection. Private destinations and redirects are blocked. Stable event IDs survive retries; transient failures use bounded exponential backoff. Sender echoes are suppressed. `accepted` means the receiver acknowledged the webhook, not that an agent ran or sent a message. The dashboard distinguishes those states.

The protocol does not offer historical replay (`cursor: null`). Subscribe before generating updates. Real dot subscription, automatic tool invocation, and event-to-user-message behavior need host acceptance testing; simulated webhook receipt alone does not verify them. Muse connects successfully when the host uses DCR plus `resource=` on authorize/token (with scopes such as `openid profile email offline_access`).

Reference: https://developers.openai.com/plugins/build/mcp-events

## Local development

For the isolated Railway sandbox, synthetic multi-user accounts, and the development-to-production workflow, see [Development and sandbox](docs/development.md).

The dashboard uses Vite, React, TypeScript, and Tailwind's official Vite plugin. `web/style.css` defines the monochrome design tokens and reusable Tailwind component styles; Geist Sans and Geist Mono are bundled locally. Screen layouts adapt for phones, tablets, and desktops, with keyboard focus rings and dialog focus handling.

Use Node 24. Copy `.env.example` to `.env.local` and supply the dedicated personal Clerk application's keys. Start FalkorDB locally with password authentication and set `FALKORDB_HOST`, `FALKORDB_PORT`, `FALKORDB_PASSWORD`, `FALKORDB_GRAPH` (profiles) and `FALKORDB_MEMORY_GRAPH` (application graph).

Run `npm ci`, `npm run build` and `npm run dev`. For frontend development run `npm run dev:web` in a second terminal; Vite forwards API requests to port 3000. Set `PUBLIC_URL` to the actual browser origin so Clerk authorized-party checks match. Production serves the built frontend from Express.

Generate `EVENT_ENCRYPTION_KEY` once as 32 random bytes encoded in base64. Preserve it across restarts; losing it makes existing event credentials unreadable. If absent, event subscriptions are not advertised. Never expose it to frontend code or commit environment files.

The dedicated personal Clerk application is `app_3KhaoAVxRR0XFfeOzTL2AqaNZoF`. Its development instance is used for this preview. A production Clerk instance needs domain configuration for a broader launch. Never use another application's keys.

## Clerk OAuth dashboard (MCP)

Clerk instance: `https://organic-buck-9271.clerk.accounts.dev` (application `app_3KhaoAVxRR0XFfeOzTL2AqaNZoF`).

On **OAuth applications → Settings**:

1. **Client onboarding** — enable **Publish DCR support** (required for hosts like Muse that dynamically register); enable **Publish CIMD support** for metadata-document `client_id`s. Set **Default scopes for dynamic clients** to at least `profile` and `email`; include `openid` / `offline_access` when hosts omit `scope` but need refresh.
2. **Authorization security** — enable **Require PKCE** so public clients must use `S256`.
3. Do not disable audience / resource binding on the MCP server. The API verifies Clerk tokens with `audience` set to the MCP URL and rejects mismatches with a self-diagnosing `invalid_token` detail. Clerk still accepts authorize/token requests that omit `resource=`; clients must send it so tokens carry the correct `aud`.

Manual public client (when DCR/CIMD is unavailable):

1. **OAuth applications → Applications → Add application**.
2. Enable **Public** (no client secret) and **Require PKCE**.
3. Add exact **Redirect URIs** for the host (examples: ChatGPT / Codex callback URLs from that product's docs; for the local verifier use `http://127.0.0.1:<port>/callback` or the `REDIRECT_URI` you pass to the script).
4. Scopes: allow `profile` and `email`.
5. Give the host only the **Client ID**. Leave client secret blank.

## Local OAuth + MCP verification

Interactive public-client check (authorization code + PKCE, `resource=` on authorize and token, then MCP `initialize` / `tools/list` / `get_connection_status`):

```bash
pip install requests
python3 scripts/verify_oauth_mcp.py
```

Optional env: `MCP_URL` (default production `/mcp`), `CLIENT_ID` (skip DCR), `REDIRECT_URI`, `OAUTH_SCOPES` (default `profile email`). The script opens a browser for human login and never hardcodes secrets.

## Verification

`npm run build`, `npm run check:web` and `npm test` check compilation, frontend types, OAuth isolation and signed Clerk webhooks.

Start an isolated FalkorDB on `127.0.0.1:16379` with password `local-verification`. Then run `npm run test:graph` and `node --import tsx --test test/api.integration.ts`. Tests create unique synthetic graphs and delete them afterward. Graph tests accept `FALKORDB_TEST_HOST`, `FALKORDB_TEST_PORT`, and `FALKORDB_TEST_PASSWORD` overrides.

The checks cover concurrent deduplication, stale revisions, private retrieval, relationship expansion, invitations, sharing/retraction, rules, client revocation, encrypted subscriptions, callback retries, origin echo suppression, and both MCP protocol paths. They also stop or expire a subscription after a delivery lease is acquired, verifying that the worker rechecks current subscription state before sending. Clerk dashboard sessions additionally require a valid session token, matching browser origin and an active provider session.

## Railway

Project `e13f89d3-e41a-4e89-96b8-dbdc0b1f87cd` is in Pranav's personal Hobby workspace. `shared-memory-mcp` builds the Dockerfile; `falkordb` runs the official server image privately. The API binds to `0.0.0.0` and honors Railway's `PORT`.

Database variables reference `${{falkordb.RAILWAY_PRIVATE_DOMAIN}}` and `${{falkordb.FALKORDB_PASSWORD}}`. A volume at `/var/lib/falkordb/data` and append-only persistence preserve records. `/health` checks database connectivity. The API worker uses durable leases so overlapping deployments do not routinely send the same delivery twice; delivery remains at-least-once, with stable IDs for receiver deduplication.

The approved scope and acceptance plan are in `docs/implementation-plan.md`. The original broader notification adapters and proactive inference engine are not represented as completed host integrations.
