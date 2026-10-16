# Development and sandbox

Codex reads the repository's [AGENTS.md](../AGENTS.md) for sandbox defaults, branch flow, checks, and the production release boundary. Each developer must pull a branch containing that file and start a fresh Codex session. Until the setup PR is merged, use `codex/development` as the base; an old checkout of `main` does not contain the instructions yet.

| | Sandbox | Production |
|---|---|---|
| Branch | `codex/development` | `main` |
| Dashboard | https://shared-memory-mcp-sandbox.up.railway.app/dashboard | https://shared-memory-mcp-production.up.railway.app/dashboard |
| MCP | https://shared-memory-mcp-sandbox.up.railway.app/mcp | https://shared-memory-mcp-production.up.railway.app/mcp |
| Clerk app | Shared Memory Sandbox (`app_3Kkji888RWnY1TIAjHITY6ZaF92`) | Original Shared Memory (`app_3KhaoAVxRR0XFfeOzTL2AqaNZoF`) |
| Storage | Dedicated private FalkorDB, volume, password, and encryption key | Existing separate DB, volume, and credentials |

Both run in project `e13f89d3-e41a-4e89-96b8-dbdc0b1f87cd` in Pranav's personal Railway Hobby workspace. Sandbox environment ID is `2ef88b92-bf75-4b31-ac2b-0c5b61627732`; profile/memory graphs are `sandbox_profiles` and `sandbox_memory`. Its Clerk development instance is `ins_3KkjiF7zViWlDNsHyTasXpqvaCC`, issuer `https://up-burro-4657.clerk.accounts.dev`. Production was not copied into it. The original deployed app also still uses a Clerk development instance; broad public launch needs production Clerk/domain configuration.

## From opening Codex to a sandbox change

1. Open the repository in Codex. Start a new worktree from the latest `codex/development` when parallel work needs isolation. Create a `codex/<feature-name>` branch, or have Codex create it. Preserve other developers' changes.
2. Implement the feature and run the relevant checks. Each developer uses their own local setup and registered credentials; a worktree is not a separate Railway environment.
3. Push the feature branch and open a PR into `codex/development`. Review/integrate it. The current CI workflow runs on pushes to development/main and PRs into main; feature PRs into development do not currently trigger CI themselves.
4. After integration, CI builds the app, checks frontend types, tests auth/webhooks, and runs real graph/API tests against an ephemeral FalkorDB. Railway waits for green GitHub checks before deploying the development branch to sandbox.
5. Verify the deployed commit and `/health`, then test the changed feature in the sandbox dashboard/MCP. One shared sandbox serves the team, so use separate spaces and operation keys. Feature branches do not deploy automatically.

## Ship a working development version to production

1. Verify the intended development commit in sandbox, review the diff and test results, and prepare any backward-compatible migration required by the change.
2. Open a PR from `codex/development` into `main`. `main` requires a PR and an up-to-date passing `checks` result; protection applies to admins too, and force pushes/deletion are blocked. A second person's approval is optional for this small team.
3. When the user has authorized shipping that release, merge the reviewed PR. No extra confirmation is needed for an already authorized release. If they asked only for a PR or an explanation, leave it ready for review.
4. Railway waits for GitHub checks on `main`, builds that code, and deploys production with its own existing variables, Clerk app, database, and volume.
5. Check production health and actual changed behavior. Bring main back into development without discarding ongoing work so subsequent releases remain up to date.

Only code is promoted. Demo accounts, test memories, sandbox credentials, and volumes are not copied to production. Code rollback does not reverse database writes. Direct CLI production deployment bypasses the normal branch workflow and needs explicit authorization; these safeguards do not remove the owner's Railway access.

## Basic shared-space dashboard

The [ontology v1 guide](ontology.md) documents the Ontology tab, typed claims, source evidence, scoped identities, snapshot publication and current retrieval limits. Source-memory sharing and selected-claim publication are separate operations.

1. Sign in as yourself and open **Shared spaces**.
2. Create a space; it opens its shared-memory feed. Existing space names open their feeds too.
3. Under **Invite a friend**, enter a verified account email, choose reader/contributor, and create an invitation link. Copy/send it yourself; the app does not currently email invitations. The friend opens the link and accepts while signed in with that email, then lands in the space.
4. **Share a memory** opens a picker of your own memories. Search/select one and confirm sharing. Add a new memory through the picker if necessary, save it privately, then select it to share. Both members' explicitly shared records appear in the same space feed, with author and timestamp.
5. Private memories and records shared only to other spaces are excluded—even if the viewer owns them. The feed supports loading further pages. Members can inspect a shared record, but only its source author can revise/forget/retract it. **Remove from space** withdraws your own share while preserving the private source.
6. Owners manage members in the space. Revoked users cannot retrieve its feed; revoking an author does not automatically retract earlier active shares visible to remaining members. Advanced automatic rules remain folded away and require an explicit opt-in.

## Test as yourself against a demo teammate

Pranav signs in with **pranavjana2003@gmail.com**, using the ordinary email sign-in flow. Roshan uses his own sandbox account. The same email in sandbox and production represents separate Clerk identities. Do not use a demo test code for a real email.

The default fixture command finds the existing verified real user and creates/reuses:

- **Sandbox collaboration**, owned by that user;
- an owner-specific **Demo Teammate Sandbox** contributor;
- a demo-authored shared graph-import task and dashboard-review proposal;
- one private record for each side, excluded from the space feed.

The user stays signed in as themselves. The demo teammate is synthetic server-side fixture activity, not a real external agent. Existing Alice/Bob/Eve data is preserved as legacy optional fixtures; normal testing does not require those logins.

Install/update the private personal [Shared Spaces Sandbox plugin](https://chatgpt.com/plugins/plugins_6ad16bfddd148191bd28a8d808f99c85), version `0.2.3`, and authorize it with your own sandbox email. Ask: **"Verify my signed-in email and show my Demo Teammate's shared updates in Sandbox collaboration."** It includes the [test checklist](../plugin/shared-spaces-sandbox/skills/shared-spaces-sandbox-testing/references/test-checklist.md). The original Shared Memory plugin still connects to production. The private plugin belongs to Pranav's ChatGPT account; Roshan needs his own sandbox MCP/plugin connection. Cloning the repository does not install/authenticate a plugin.

### OAuth scope troubleshooting

Clerk's discovery documents advertise `public_metadata` and `private_metadata`, but sandbox clients are deliberately restricted to basic identity scopes. The sandbox plugin explicitly limits both default and OIDC scopes. For a manually added Codex MCP, add this to its existing entry in `~/.codex/config.toml` (use your actual entry name):

```toml
[mcp_servers.shared_memory_sandbox]
url = "https://shared-memory-mcp-sandbox.up.railway.app/mcp"
scopes = ["openid", "profile", "email", "offline_access"]
```

After an `invalid_scope` error, reconnect the same sandbox entry using those scopes; do not enable metadata scopes or relax audience/PKCE checks. A CLI retry can explicitly select the scopes:

```sh
codex mcp login shared_memory_sandbox --scopes openid,profile,email,offline_access
```

Finish sign-in as your own sandbox user, then verify `get_connection_status` from a fresh chat. A failed OAuth callback page cannot be reused after configuration changes.

## Guarded fixture operator

With a current Railway CLI (setup used 5.69.0), preview inside the sandbox API service:

```sh
npx -y @railway/cli@5.69.0 ssh \
  --project e13f89d3-e41a-4e89-96b8-dbdc0b1f87cd \
  --environment sandbox --service shared-memory-mcp \
  -i ~/.ssh/id_ed25519_shared_memory_railway -- npm run sandbox:seed
```

The identity path is Pranav's registered local development key. Each developer registers their own Railway key and substitutes its path; never share a private key. Commands below run **inside that sandbox service**, using the same SSH prefix:

```sh
# Create/reuse fixtures for Pranav's existing verified sandbox account.
npm run sandbox:seed -- --apply
# Another developer first signs into sandbox, then targets their own email.
npm run sandbox:seed -- --owner-email YOUR_EMAIL --apply
# Generate an incoming synthetic teammate update without changing user login.
npm run sandbox:seed -- --demo-update demo-progress-001 --apply
# Only on an explicit request, restore revoked/changed demo membership.
npm run sandbox:seed -- --restore-demo-membership --apply
```

Use a new demo-update key per requested update, and reuse it for retries. The operator returns actual space/memory IDs and checks allowed shared retrieval plus denied private retrieval on both sides. It refuses mixed/production Railway IDs, graph names, keys, issuer, or live Clerk instance. Without `--apply` it is read-only. It never creates/impersonates a real human account, resets a database, erases experiments, or silently restores a revoked demo member. A fresh invitation is issued/accepted only with the explicit restoration flag. Reruns also preserve manual share retractions.

For proactive testing, first subscribe your own agent on a host with real MCP event support, then request a new simulated teammate update. A share, webhook receipt, and actual user-visible notification are different outcomes. Hosts without event subscriptions can still perform on-demand recall. Do not claim automatic messages without real host evidence.

## Local configuration and known limits

Use Node 24 and `npm ci`; see README for Vite/Express and test commands. Use sandbox Clerk keys, a local authenticated FalkorDB, and distinct local graph names for local execution. `npm run dev`/`npm start` load `.env.local`; the existing file on Pranav's laptop targets the original application, so verify effective values before starting. `.env.sandbox.local` contains only sandbox Clerk credentials, is ignored by Git/Docker, and is not a complete local DB configuration. Fresh clones/worktrees do not automatically contain ignored credentials.

Hosted DB references resolve within each Railway environment. FalkorDB has no public endpoint, uses password authentication, and persists append-only data on its own volume at `/var/lib/falkordb/data`. Preserve event encryption keys across restarts; do not log or commit secret values. GitHub CI uses synthetic identities and a temporary database with no provider credentials.

Sandbox Clerk OAuth/PKCE/audience settings and normal email login are configured. Its Clerk lifecycle webhook subscription is still a parity gap: profiles sync at login/startup/seeding; immediate provider-side deletion propagation needs a sandbox `/webhooks/clerk` subscription for user.created/updated/deleted and its signing secret in sandbox `CLERK_WEBHOOK_SIGNING_SECRET`. Shared-memory event subscriptions are separate and enabled by the event encryption key. Browser sign-in and real host notification behavior must be verified in the client, not inferred from seed/test results.

## Semantic memory development

See [everyday-memory-research.md](everyday-memory-research.md) for schema 1.1, the OWL decision, FalkorDB search design, optimizations and evaluation limits. Configure `EMBEDDING_PROVIDER=openrouter` and a private `OPENROUTER_API_KEY` in sandbox only for ordinary development. Direct Gemini uses `EMBEDDING_PROVIDER=gemini` and `GEMINI_API_KEY`. Model/dimensions are pinned in code to Gemini Embedding 2 / 768; changing the embedding signature requires reindexing. `EMBEDDING_OPENROUTER_IGNORE` optionally excludes comma-separated routes; the current sandbox excludes Google AI Studio after that route returned an upstream key error while another route succeeded. This is an operational workaround, not a statement that the account's OpenRouter key is invalid.

New claim writes index automatically; existing private current claims use `index_knowledge` in batches up to 20. Old ABOUT claims are not automatically reinterpreted. No cross-environment data copy occurs. Shared publications index only their frozen projection; backfill currently covers private claims, while retrying an active authored publication indexes that snapshot. Provider failure leaves source writes saved with pending index status, and retrieval reports semantic availability.

For a local live-model benchmark: build the server, load a dedicated ignored environment containing only embedding credentials, then run `node --env-file=YOUR_PRIVATE_EMBEDDING_ENV scripts/benchmark-knowledge.mjs`. The script uses an isolated loopback DB at test port 16379, creates a unique synthetic graph, and deletes it. Do not use `.env.local` blindly or run integration tests against a hosted DB.

### Automatic ontology extraction

Set `ONTOLOGY_PROVIDER=openrouter` and `ONTOLOGY_MODEL=openai/gpt-4.1-mini` explicitly in the sandbox API service. This uses the same personal `OPENROUTER_API_KEY`, but performs a structured chat-model extraction, separate from Gemini Embedding 2 vectors. `ONTOLOGY_OPENROUTER_IGNORE` optionally excludes routes independently of embedding routing. Without explicit provider configuration, saves report `ontology.status=not_configured`. Do not infer model availability from a configured embedding provider.

New source revisions enqueue a persistent FalkorDB job atomically; the save handler processes it immediately and the worker retries eligible failures after restarts. Details and limits are in [ontology.md](ontology.md#automatic-structuring-on-save). Operators can inspect `OntologyJob` status/attempts/nextAt and linked source revision inside the intended environment; never print its private plan. After investigating an exhausted job, reset its attempts/nextAt only under the exact owner/current-revision guard. Do not reset structured jobs to rerun a model against an already committed retry key. Forgetting clears private job plans.

`npm run test:graph` includes extraction integration tests with a fake provider, isolated local FalkorDB, no hosted database or model calls. `scripts/benchmark-extraction.mjs` is an optional live-provider regression check: build the server, use a dedicated private env containing only the model credentials/config, then run `node --env-file=YOUR_PRIVATE_MODEL_ENV scripts/benchmark-extraction.mjs`. It uses synthetic facts and creates/deletes its own loopback graph. Never point it at hosted data or load `.env.local` blindly. Its everyday-case coverage is a regression check, not a general accuracy claim.

Live-provider regression on 2026-10-16 passed all 8 synthetic cases using GPT-4.1 mini through OpenRouter (employment/role, career desire/concern, negation, debt with unknown currency, preference, trip with unknown date, assignment without acceptance, and quoted instructions). Extraction latency was roughly 0.6–7.3 seconds with embedding disabled in that isolated benchmark; this does not measure the extra indexing cost or general extraction accuracy. The Google Flash-Lite structured-output route returned an upstream invalid-argument error during verification, so extraction uses GPT-4.1 mini; Gemini Embedding 2 remains the retrieval model. Integration follows [OpenRouter's structured-output API](https://openrouter.ai/docs/guides/features/structured-outputs) and its [GPT-4.1 mini model](https://openrouter.ai/openai/gpt-4.1-mini).

## Shared-space agent notifications

Open a space and expand **Agent notifications**. Choose **Dot** or **Muse**, copy the generated setup prompt, and give it to your own agent while signed into your own sandbox account. Copying a prompt does not subscribe anything. Refresh status to see actual subscriptions/expiry and stop individual subscriptions. The agent must subscribe to both `memory.changed` (explicit whole-memory shares/revisions/retractions) and `knowledge.changed` (explicit selected-claim publications/retractions), filtered by that space's ID. Private saves never create either event unless a previously enabled whole-memory sharing rule applies. Notification permission does not grant permission to share private memories.

Dot supports webhook MCP Events through the private sandbox plugin in a Dot or a supported Cloud Work chat, per [official OpenAI documentation](https://developers.openai.com/plugins/build/mcp-events). Rescan the plugin server after changes to its events/tools. Muse must actually provide a persistent HTTPS receiver and a background trigger; a working MCP connection is insufficient. The generated Muse prompt explicitly checks for these capabilities and reports unsupported behavior rather than inventing a URL or silently installing a polling task. No generic Muse adapter or arbitrary agent wake-up API is assumed.

The server's existing signed callback challenge, encrypted secret/grant storage, OAuth expiry/refresh, current membership/client checks, retries, stable event IDs and sender-echo suppression apply to both event types. Legacy subscriptions without an `eventName` remain `memory.changed`. Publication events contain only a space-scoped `publication_id`, never the author's private source ID or text. Recipients call `get_shared_update` with the event's `space_id` and its `memory_id`/`publication_id`; the returned update and related claim context are restricted to that same space. Even a source owner cannot use this space packet to retrieve a record that was never shared there. A withdrawn snapshot returns not found; retraction notices contain only metadata. Source revisions do not republish frozen selected claims. Forgetting suppresses future snapshot reads/deliveries but does not currently emit a separate withdrawal event for every publication.

Acceptance: first verify an actual host subscription in this dashboard, then generate a **new** requested demo teammate update using the guarded fixture command. Check webhook acceptance in Activity, recipient scoped retrieval, and an actual user-visible message in the receiving app as separate outcomes. A server test or HTTP 2xx cannot verify a host notification. Normal tests never require a friend's login. Keep the sandbox owner identity; don't reset spaces or restore revoked demo membership implicitly.

Local tests cover event separation, selected-publication privacy, signed delivery, retries, duplicate publish/retract, sender-echo suppression, scoped context reads, unsubscribe and revocation using an isolated local FalkorDB and synthetic callbacks. These do not prove Muse or Dot accepted a live subscription or ran an agent.

Notification queue recovery marks no-longer-readable pending updates as revoked so they cannot block later eligible updates. Sender-authored events are excluded before pagination. Subscription refresh preserves its start time while active; reactivation after unsubscribe/expiry starts at the new subscription time rather than replaying activity from the inactive gap.
