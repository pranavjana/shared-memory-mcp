# Shared Memory development instructions

These repository-wide defaults apply to Pranav, Roshan, and coding agents working in this checkout. Develop and test against the sandbox unless the user explicitly authorizes a production task. Detailed setup and operator commands are in [docs/development.md](docs/development.md); read it before changing deployment, authentication, storage, or shared-space behavior.

## Start every task

- Inspect the current branch, worktree, and uncommitted changes. Preserve other work; do not reset, discard, or overwrite it.
- Fetch remote refs before choosing a starting point. New features start from the latest `origin/codex/development` on their own `codex/<feature-name>` branch. Keep an existing suitable feature branch instead of recreating it.
- Use a separate worktree when parallel work would interfere with the current checkout. Pranav and Roshan should use separate feature branches. Routine documentation maintenance can stay on `codex/development` when the checkout is clean and no other work is affected.
- Confirm the target environment before running an app, database command, seed, migration, or Railway mutation. A local repository checkout or a fresh Codex chat does not select a safe runtime environment by itself.

## Sandbox defaults

| Setting | Development default |
|---|---|
| GitHub repository | `pranavjana/shared-memory-mcp` |
| Integration/deployment branch | `codex/development` |
| Railway project | `shared-memory-mcp` / `e13f89d3-e41a-4e89-96b8-dbdc0b1f87cd` |
| Railway workspace | Pranav's personal workspace, not TinyFish |
| Railway environment | `sandbox` / `2ef88b92-bf75-4b31-ac2b-0c5b61627732` |
| Dashboard | https://shared-memory-mcp-sandbox.up.railway.app/dashboard |
| MCP endpoint | https://shared-memory-mcp-sandbox.up.railway.app/mcp |
| Clerk application | Shared Memory Sandbox / `app_3Kkji888RWnY1TIAjHITY6ZaF92` |
| Clerk development instance | `ins_3KkjiF7zViWlDNsHyTasXpqvaCC` |
| Clerk issuer | `https://up-burro-4657.clerk.accounts.dev` |
| Hosted profile / memory graphs | `sandbox_profiles` / `sandbox_memory` |
| Testing plugin source | `plugin/shared-spaces-sandbox/` |

- Pass the project, environment, and service explicitly to Railway commands. Do not rely on the CLI's linked environment; it may be production.
- Keep the sandbox API, FalkorDB volume, DB password, and Clerk keys separate from production. Database references must resolve within the sandbox; do not introduce cross-environment production references or public DB access.
- Use a local FalkorDB with separate local/test graph names for local execution. The hosted sandbox is shared: use unique test spaces and operation keys, and do not reset another developer's experiments.

## Local execution and secrets

- Use Node 24 and `npm ci`. The frontend is Vite/React/Tailwind; Express serves the built frontend and MCP/API.
- `npm run dev` and `npm start` automatically load `.env.local`. The existing file on Pranav's machine targets the original application. Do not run these commands until the effective configuration has been verified or replaced with a dedicated local configuration using sandbox Clerk credentials and a local DB. Do not overwrite someone else's environment file.
- `.env.sandbox.local`, when present, contains sandbox Clerk credentials only; it is not a complete local database configuration. Ignored environment files are not guaranteed to exist in a fresh clone or worktree.
- Check actual environment/app/instance IDs, not just `sk_test_` or `NODE_ENV`. The original deployed application also currently uses a Clerk development instance; Railway containers use `NODE_ENV=production` in the sandbox too.
- Never commit, print, or paste secrets, tokens, private keys, or raw credential-bearing provider responses. Each developer obtains their own authorized local credentials and Railway SSH key; do not share Pranav's private key or depend on his absolute filesystem paths.

## Build, validate, and deploy development changes

1. Implement and review the feature on its feature branch. Run checks appropriate to the changed behavior; documentation-only edits do not require inventing tests.
2. For code changes, use `npm run build`, `npm run check:web`, and `npm test`. For memory, permission, database, or auth/API changes, also run `npm run test:graph` and `node --import tsx --test test/api.integration.ts` against the isolated local test DB described in `docs/development.md`. Do not point integration tests at either hosted database.
3. Keep `skills/shared-memory/SKILL.md` and the production plugin's bundled copy identical when editing the operating guide (MCP `memory_instructions` returns that file). Keep `skills/shared-space-watch-muse|grok|dot/` identical to the plugin copies; those three are the only host watch skills. Review the sandbox plugin's reference copy if the same behavior changes.
4. Push the feature branch and open a PR targeting `codex/development`. Review before integration. Feature branches do not deploy automatically. The current CI workflow runs on pushes to `codex/development`/`main` and PRs targeting `main`; it does not currently run on feature PRs targeting development.
5. Once the feature is integrated into `codex/development`, GitHub CI runs and Railway waits for passing checks before deploying the sandbox. Verify the deployment's commit/status and `/health`, then exercise the changed behavior. A push, green build, or authenticated connection alone does not prove the feature works.
6. Report what changed, checks performed, sandbox verification, and anything still untested. Keep ordinary development work in the sandbox; do not promote it to production implicitly.

## Multi-user and MCP testing

- Pranav tests as `pranavjana2003@gmail.com` in the sandbox; Roshan uses his own verified sandbox login. Do not ask them to switch to Alice, Bob, or a demo account for normal testing. Sandbox and production identities are separate even when their emails match.
- `scripts/sandbox-seed.mjs` creates an owner-specific synthetic Demo Teammate and a `Sandbox collaboration` space owned by the real user, with shared demo updates and private denial-test records. It requires an existing verified owner account; another developer supplies `--owner-email <their-email>`. See the [test checklist](plugin/shared-spaces-sandbox/skills/shared-spaces-sandbox-testing/references/test-checklist.md).
- Use the Shared Spaces Sandbox plugin/endpoint. The original Shared Memory plugin connects to production. Do not substitute its tools when sandbox tools are missing.
- Verify the authenticated email with the sandbox `get_connection_status`, keeping the user signed in as themselves. A second chat or a name in a prompt does not change an OAuth identity. Do not impersonate the demo account through the user's MCP connection.
- Test allowed and denied paths: the user reads demo-shared updates but cannot read/edit the teammate's private/source records; the teammate cannot read the user's private note. Automated graph/API tests exercise the recipient/outsider/revocation side without requiring demo logins. Use actual receipts/errors as evidence.
- Membership is not permission to share all memories. Keep memories private unless explicitly selected for sharing or covered by a user-enabled rule. OAuth/account and space boundaries must remain enforced; do not add development auth bypasses or accept tokens for the wrong resource.
- The guarded hosted fixture script defaults to a dry run. For requested incoming demo activity, use `--demo-update <stable-operation-key> --apply` inside the sandbox service, reusing the key on retries. This simulates a teammate write server-side, not an actual external agent or notification. Ordinary reruns preserve retractions and changed/revoked membership; restoring demo membership requires the explicit `--restore-demo-membership` option. It has no database reset operation.
- The sandbox plugin is private to its owning ChatGPT account. Roshan needs his own authorized sandbox MCP connection or plugin; cloning the repo does not install or authenticate a plugin.
- A share receipt is not an agent notification; proactive delivery is not currently available. The sandbox Clerk lifecycle webhook subscription is not yet configured; check `docs/development.md` for that remaining parity gap.

## Production release boundary

- `main` deploys production. Do not push directly to `main`, bypass branch protection/CI, deploy production from the CLI, change production infrastructure/credentials, or write/migrate/reset production data without explicit authorization for that action. Honor authorization already given in the current task; do not request it repeatedly.
- Normal promotion is a reviewed PR from `codex/development` to `main` with an up-to-date passing `checks` result. Prepare the diff, validation, and any migration plan before requesting a release decision. Merge/deploy only when the user has authorized the release.
- Promotion moves code, not sandbox accounts, memories, variables, or volumes. Use backward-compatible DB changes or an explicit migration plan; code rollback does not undo database writes.
- After an authorized release, verify production health and changed behavior, then bring `main` back into `codex/development` without discarding ongoing work so future promotions stay current.

These are agent operating instructions, not runtime enforcement. Before claiming a safeguard is enforced, verify the relevant code/provider configuration and actual result.
