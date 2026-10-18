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

For a polished demo graph on one account, `npm run sandbox:demo-ontology -- [--owner-email EMAIL] --apply` adds 17 realistic memories with hand-written ontology claims (people, projects, events, tasks, a decision, preferences, a routine, an obligation and a negated claim). Each memory is attributed to an assistant that account has connected, and its extraction job is settled so the worker does not add duplicates. Retry keys start with `demo-ontology-v1`; reruns add nothing. Without `--apply` it only validates and counts.

Use a new demo-update key per requested update, and reuse it for retries. The operator returns actual space/memory IDs and checks allowed shared retrieval plus denied private retrieval on both sides. It refuses mixed/production Railway IDs, graph names, keys, issuer, or live Clerk instance. Without `--apply` it is read-only. It never creates/impersonates a real human account, resets a database, erases experiments, or silently restores a revoked demo member. A fresh invitation is issued/accepted only with the explicit restoration flag. Reruns also preserve manual share retractions.

Proactive delivery to other members' agents is not currently available; check incoming demo updates with on-demand recall or `get_shared_update`. Do not claim automatic messages.

## Local configuration and known limits

Use Node 24 and `npm ci`; see README for Vite/Express and test commands. Use sandbox Clerk keys, a local authenticated FalkorDB, and distinct local graph names for local execution. `npm run dev`/`npm start` load `.env.local`; the existing file on Pranav's laptop targets the original application, so verify effective values before starting. `.env.sandbox.local` contains only sandbox Clerk credentials, is ignored by Git/Docker, and is not a complete local DB configuration. Fresh clones/worktrees do not automatically contain ignored credentials.

Hosted DB references resolve within each Railway environment. FalkorDB has no public endpoint, uses password authentication, and persists append-only data on its own volume at `/var/lib/falkordb/data`. Do not log or commit secret values. GitHub CI uses synthetic identities and a temporary database with no provider credentials.

Sandbox Clerk OAuth/PKCE/audience settings and normal email login are configured. Its Clerk lifecycle webhook subscription is still a parity gap: profiles sync at login/startup/seeding; immediate provider-side deletion propagation needs a sandbox `/webhooks/clerk` subscription for user.created/updated/deleted and its signing secret in sandbox `CLERK_WEBHOOK_SIGNING_SECRET`. Browser sign-in behavior must be verified in the client, not inferred from seed/test results.

## Semantic memory development

See [everyday-memory-research.md](everyday-memory-research.md) for schema 1.1, the OWL decision, FalkorDB search design, optimizations and evaluation limits. Configure `EMBEDDING_PROVIDER=openrouter` and a private `OPENROUTER_API_KEY` in sandbox only for ordinary development. Direct Gemini uses `EMBEDDING_PROVIDER=gemini` and `GEMINI_API_KEY`. Model/dimensions are pinned in code to Gemini Embedding 2 / 768; changing the embedding signature requires reindexing. `EMBEDDING_OPENROUTER_IGNORE` optionally excludes comma-separated routes; the current sandbox excludes Google AI Studio after that route returned an upstream key error while another route succeeded. This is an operational workaround, not a statement that the account's OpenRouter key is invalid.

New claim writes index automatically; existing private current claims use `index_knowledge` in batches up to 20. Old ABOUT claims are not automatically reinterpreted. No cross-environment data copy occurs. Shared publications index only their frozen projection; backfill currently covers private claims, while retrying an active authored publication indexes that snapshot. Provider failure leaves source writes saved with pending index status, and retrieval reports semantic availability.

For a local live-model benchmark: build the server, load a dedicated ignored environment containing only embedding credentials, then run `node --env-file=YOUR_PRIVATE_EMBEDDING_ENV scripts/benchmark-knowledge.mjs`. The script uses an isolated loopback DB at test port 16379, creates a unique synthetic graph, and deletes it. Do not use `.env.local` blindly or run integration tests against a hosted DB.

### Automatic ontology extraction

Set `ONTOLOGY_PROVIDER=openrouter` and `ONTOLOGY_MODEL=openai/gpt-4.1-mini` explicitly in the sandbox API service. This uses the same personal `OPENROUTER_API_KEY`, but performs a structured chat-model extraction, separate from Gemini Embedding 2 vectors. `ONTOLOGY_OPENROUTER_IGNORE` optionally excludes routes independently of embedding routing. Without explicit provider configuration, saves report `ontology.status=not_configured`. Do not infer model availability from a configured embedding provider.

New source revisions enqueue a persistent FalkorDB job atomically; the save handler processes it immediately and the worker retries eligible failures after restarts. Details and limits are in [ontology.md](ontology.md#automatic-structuring-on-save). Operators can inspect `OntologyJob` status/attempts/nextAt and linked source revision inside the intended environment; never print its private plan. After investigating an exhausted job, reset its attempts/nextAt only under the exact owner/current-revision guard. Do not reset structured jobs to rerun a model against an already committed retry key. Forgetting clears private job plans.

`npm run test:graph` includes extraction integration tests with a fake provider, isolated local FalkorDB, no hosted database or model calls. `scripts/benchmark-extraction.mjs` is an optional live-provider regression check: build the server, use a dedicated private env containing only the model credentials/config, then run `node --env-file=YOUR_PRIVATE_MODEL_ENV scripts/benchmark-extraction.mjs`. It uses synthetic facts and creates/deletes its own loopback graph. Never point it at hosted data or load `.env.local` blindly. Its everyday-case coverage is a regression check, not a general accuracy claim.

Live-provider regression on 2026-10-16 passed all 8 synthetic cases using GPT-4.1 mini through OpenRouter (employment/role, career desire/concern, negation, debt with unknown currency, preference, trip with unknown date, assignment without acceptance, and quoted instructions). Extraction latency was roughly 0.6–7.3 seconds with embedding disabled in that isolated benchmark; this does not measure the extra indexing cost or general extraction accuracy. The Google Flash-Lite structured-output route returned an upstream invalid-argument error during verification, so extraction uses GPT-4.1 mini; Gemini Embedding 2 remains the retrieval model. Integration follows [OpenRouter's structured-output API](https://openrouter.ai/docs/guides/features/structured-outputs) and its [GPT-4.1 mini model](https://openrouter.ai/openai/gpt-4.1-mini).

## Shared-space updates

Webhook-based MCP Events (`events/*`, `memory.changed`, `knowledge.changed`, `notification_setup`, dashboard Agent notifications and Activity) were removed. On startup the server deactivates any legacy `Subscription` nodes and clears their stored callback secrets and grant tokens; `Change` records of shares, revisions and publications remain.

Recipients call `get_shared_update` with the space ID and a memory or publication ID; the returned update and related claim context are restricted to that same space. Even a source owner cannot use this space packet to retrieve a record that was never shared there. A withdrawn snapshot returns not found. Source revisions do not republish frozen selected claims. Sharing a whole memory is different: `share_memory` publishes that memory's current claims into the space (marked `viaShare`), replaces them when the memory is revised or re-extracted, and withdraws them when the share is retracted. Explicit `publish_claim` snapshots are never touched by that sync. Extraction jobs settle as `failed` after their final retry instead of staying `pending`.

### Provisional relationships and negation (ontology 1.2.0)

When no core relationship expresses a stated fact, extraction may propose up to three `newPredicates`. The server normalizes each name (UPPER_SNAKE, 3–40 chars), rejects instruction-like names, and reuses an existing relationship with the same root (`SPEAKS` / `CAN_SPEAK`), or one whose name is broader or narrower if its types already fit. A provisional relationship is persisted only when a valid claim uses it, with at most five new ones per author per day and 100 provisional overall. Later extractions receive the provisional list as untrusted payload data.

Reviewers are the verified emails in `ONTOLOGY_ADMIN_EMAILS` (comma-separated, per Railway environment). In the dashboard ontology schema panel they can approve a relationship, merge it into another (rewriting existing claims and space snapshots), or reject it (retiring its claims and withdrawing their snapshots; the same root cannot be proposed again). Review shows names, types and counts only, never another user's claims or evidence.

In a shared space, people in snapshots resolve to space members: the claim's author (first-person "self" or their own name), or the only active member whose full or first name matches. Two members sharing that name link to neither. Linked entities use one space node per member (`memberId`, the member's display name, the mention as an alias); everything else in the snapshot is unchanged. Snapshots are re-resolved when a member joins or is removed (`relinkSpace`). Private graphs are never merged across authors. Within one author's extraction, their own full name is the same node as "self".

Explicit negations are stored as claims with `negated: true`, never as the affirmative fact. Date-only or unparseable validity times are dropped rather than discarding the claim. Memories with `no_supported_claims` or `failed` show "Not in ontology" on the dashboard, and their owner can retry extraction. Local tests cover selected-publication privacy, duplicate publish/retract, scoped context reads and revocation using an isolated local FalkorDB.
