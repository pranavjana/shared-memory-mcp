# Shared Memory MCP

An OAuth-protected MCP server for shared personal memory across assistants. This release establishes Clerk user accounts, a persistent FalkorDB user store, and the ChatGPT connector connection. Memory storage and notifications are future milestones.

## Connect

MCP endpoint: `https://shared-memory-mcp-production.up.railway.app/mcp`

In ChatGPT, enable developer mode in settings if needed, create a custom app with the endpoint above, and choose OAuth. Use automatic client registration with no manually entered client ID or secret. Sign in through Clerk and approve the requested profile and email access. Then ask ChatGPT to call `get_connection_status`.

The only tool in this release is `get_connection_status`. It returns the authorized user's ID, name, primary email, and connection capabilities. It accepts no user ID input. It does not read chats, store memories, or run external actions.

## Authentication

Clerk hosts account creation, sign-in, user management, and OAuth consent. The dedicated personal Clerk application is `app_3KhaoAVxRR0XFfeOzTL2AqaNZoF`; its development instance is used for this connection preview. A production Clerk instance requires its own domain setup before a broader launch.

- Authorization code flow requires PKCE S256.
- Both CIMD and dynamic client registration are enabled for MCP clients.
- Default scopes are `openid profile email`; Clerk also supports refresh tokens through `offline_access`.
- Access tokens are audience-bound to the `/mcp` resource.
- Opaque access tokens are used so revoking the grant immediately blocks subsequent requests; JWT access tokens are disabled.
- Every MCP request is verified through this Clerk instance's token introspection, checking audience, revocation, expiry, subject, and required scopes.
- Each request creates its own MCP server and transport, so users do not share session state.
- Missing or invalid credentials return a 401 challenge pointing to public protected-resource metadata.
- Secret keys stay in ignored `.env.local` and Railway variables. They are excluded from Docker builds.

Discovery endpoints:

- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server` (legacy discovery compatibility; issuer remains Clerk)

## User profiles

Clerk remains the source of truth for accounts and authentication. FalkorDB stores one `User` node per Clerk ID (the equivalent of a basic users table), with a unique indexed `clerkId`, primary `email`, `firstName`, `lastName`, `imageUrl`, and provider `createdAt` / `updatedAt` plus `syncedAt` timestamps.

Signed Clerk webhooks at `/webhooks/clerk` sync `user.created`, `user.updated`, and `user.deleted`. Existing users are backfilled on startup, and authenticated connection checks refresh the caller's profile. Upserts are parameterized and reject older updates. Deletion removes profile fields and retains an ID/timestamp tombstone so delayed events cannot restore the profile. Private Clerk metadata, credentials, chats, and memories are not copied.

The Railway `falkordb` service is password protected and accessible only on the private network. Append-only persistence uses a volume mounted at `/var/lib/falkordb/data`. `/health` checks database connectivity.

## Local development

Use Node.js 24. Install dependencies with `npm ci`, copy `.env.example` to `.env.local`, and supply keys from the dedicated Clerk application. `CLERK_ACCOUNT_PORTAL_URL` is the hosted account portal URL from Clerk. Set `PUBLIC_URL=http://localhost:3000` for local use; hosted OAuth clients require a public HTTPS endpoint.

Start a local FalkorDB server and set `FALKORDB_HOST`, `FALKORDB_PORT`, `FALKORDB_PASSWORD`, and `FALKORDB_GRAPH` from `.env.example`. Run `npm run dev`. Verify with `npm test` and `npm run build`. `node test/users.integration.mjs` checks the actual database in an isolated graph and deletes that test graph afterward; run it with the database variables available.

For webhook development, forward Clerk events to `/webhooks/clerk` using a public HTTPS development tunnel and set `CLERK_WEBHOOK_SIGNING_SECRET` to that endpoint's signing secret. Never reuse the hosted endpoint's secret for a different endpoint.

For a complete browser OAuth check, run `node --env-file=.env.local test/live-oauth.mjs` and open the printed localhost test URL. This creates an isolated synthetic user and OAuth client, checks registration, PKCE, audience rejection, an authenticated MCP tool call, refresh, and revocation, and removes both test resources afterward. The deployed preview passed this flow.

## Railway

The dedicated project is `e13f89d3-e41a-4e89-96b8-dbdc0b1f87cd`, service `shared-memory-mcp`, in the personal Hobby workspace. Railway builds the Dockerfile and checks `/health`. The server binds to `0.0.0.0` and honors `PORT`.

Set `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_ACCOUNT_PORTAL_URL`, `CLERK_WEBHOOK_SIGNING_SECRET`, and `PUBLIC_URL` as service variables. Set `FALKORDB_HOST` to `${{falkordb.RAILWAY_PRIVATE_DOMAIN}}` and `FALKORDB_PASSWORD` to `${{falkordb.FALKORDB_PASSWORD}}`. The secret key must come from the dedicated personal Clerk app. Never use another app's keys.

The PRD's graph-backed remember/recall/update operations, history, deduplication, notification worker, dashboard, and two-client acceptance demo have not been implemented yet.
