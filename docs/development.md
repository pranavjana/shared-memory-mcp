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

Install/update the private personal [Shared Spaces Sandbox plugin](https://chatgpt.com/plugins/plugins_6ad16bfddd148191bd28a8d808f99c85), version `0.2.0`, and authorize it with your own sandbox email. Ask: **"Verify my signed-in email and show my Demo Teammate's shared updates in Sandbox collaboration."** It includes the [test checklist](../plugin/shared-spaces-sandbox/skills/shared-spaces-sandbox-testing/references/test-checklist.md). The original Shared Memory plugin still connects to production. The private plugin belongs to Pranav's ChatGPT account; Roshan needs his own sandbox MCP/plugin connection. Cloning the repository does not install/authenticate a plugin.

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
