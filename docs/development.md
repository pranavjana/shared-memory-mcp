# Development and sandbox

Use the persistent Railway `sandbox` environment for development and multi-user testing. It is a separate running API and FalkorDB instance in the existing personal Railway project, with its own volume, password, event encryption key, and Clerk app. It was created empty; production data was not copied.

| | Sandbox | Production |
|---|---|---|
| Git branch | `codex/development` | `main` |
| Dashboard | https://shared-memory-mcp-sandbox.up.railway.app/dashboard | https://shared-memory-mcp-production.up.railway.app/dashboard |
| MCP | https://shared-memory-mcp-sandbox.up.railway.app/mcp | https://shared-memory-mcp-production.up.railway.app/mcp |
| Clerk app | Shared Memory Sandbox (`app_3Kkji888RWnY1TIAjHITY6ZaF92`) | Original Shared Memory app (`app_3KhaoAVxRR0XFfeOzTL2AqaNZoF`) |
| Profile graph | `sandbox_profiles` | Existing production configuration |
| Memory graph | `sandbox_memory` | Existing production configuration |
| Database | Private FalkorDB with a dedicated persistent volume | Existing private FalkorDB and volume |

Railway environment ID: `2ef88b92-bf75-4b31-ac2b-0c5b61627732`. The sandbox Clerk development instance is `ins_3KkjiF7zViWlDNsHyTasXpqvaCC`. Both Clerk apps are in Pranav's personal account. The original application's current development-instance status is unchanged; a public launch still needs production Clerk configuration.

## Normal workflow

1. Start a feature branch from `codex/development`, or work on that branch for a small change. Run the relevant local checks.
2. Merge the feature into `codex/development` and push. GitHub CI builds the app, checks frontend types, tests auth/webhooks, and runs graph/API integration tests against an ephemeral FalkorDB. Railway's sandbox source is this branch and waits for GitHub checks before deployment.
3. Test the sandbox dashboard and MCP using the synthetic accounts below. For MCP testing, add a **separate connection** with the sandbox MCP URL and authorize a sandbox user. Existing production connectors continue using the production URL and identity system.
4. Open a pull request from `codex/development` to `main`. Review the diff and green `checks` result, then merge deliberately. Railway production follows `main`; pushing development code does not promote it.
5. Check production `/health` and the changed behavior after promotion. Code promotion does not copy sandbox accounts, memories, variables, or volumes into production.

Use separate browser profiles for Alice and Bob when testing simultaneously. Switching between production and sandbox is a new login because they use separate Clerk instances. No production auth bypass or impersonation endpoint exists.

## Test accounts

| Account | Email | Initial access |
|---|---|---|
| Alice Sandbox | `alice+clerk_test@example.com` | Owner of Shared Spaces Sandbox |
| Bob Sandbox | `bob+clerk_test@example.com` | Contributor in that space |
| Eve Sandbox | `eve+clerk_test@example.com` | Outsider with no access |

Sign in using an email code: **424242**. These are [Clerk development test addresses](https://clerk.com/docs/guides/development/testing/test-emails-and-phones); Clerk does not deliver email to them. This is not a production login mechanism.

The seed creates one private memory each for Alice and Bob, plus one Alice-authored memory shared with Bob. All contents are labeled synthetic. Verify that Bob can read the shared memory, cannot read Alice's private memory or modify her source, and Eve cannot access the space. Test retracting a share and revoking Bob, then issue a new invitation to restore access. The graph/API CI suite also exercises these boundaries, revision history, retries, rules, client revocation, and subscription delivery.

## Seeding and operator safeguards

The deployed container contains an idempotent fixture script. With the Railway CLI authenticated to the personal workspace, preview its plan:

```sh
railway ssh --project e13f89d3-e41a-4e89-96b8-dbdc0b1f87cd \
  --environment sandbox --service shared-memory-mcp -- npm run sandbox:seed
```

Apply it by appending `-- --apply` after `npm run sandbox:seed`. It validates the Railway environment, exact graph names, sandbox publishable-key issuer, configured app/instance IDs, and the live Clerk instance before creating anything. It refuses a production or mixed target. The default is read-only; it has no reset/delete command. Run one seed operation at a time. Existing test users and memories are reused; rerunning does not erase experiments or undo edits/retractions.

To test a fresh scenario, create a new space or synthetic memory. Do not use the production friend's account. If a full reset is needed later, target only this environment's two graphs after verifying its environment ID and private database host. Removing the sandbox volume destroys sandbox data; ordinary deployments preserve it.

## Configuration and local development

Provider secrets stay in Railway variables and ignored local environment files. `.env.local` still targets the original app. `.env.sandbox.local` contains only the sandbox Clerk development credentials, is ignored by Git, and is excluded from the Docker build context. It is not a complete local database configuration. Never run a script against production by copying its DB credentials into a development file.

For local work, use a local FalkorDB and the sandbox Clerk keys, a separate local graph name, and `PUBLIC_URL=http://localhost:3000`. The fixture script is intentionally restricted to the deployed sandbox; local integration tests generate their own temporary graphs instead. See the README for the Vite/Express commands.

Sandbox database references such as `${{falkordb.RAILWAY_PRIVATE_DOMAIN}}` resolve inside the **sandbox environment**. There are no explicit cross-environment production references. The DB has no public endpoint. Its volume mounts at `/var/lib/falkordb/data`, with password authentication and append-only persistence. Both environments consume resources in the same Railway Hobby workspace.

GitHub CI has no deployment keys or Clerk secrets. Tests use synthetic identities and an ephemeral database. Railway's GitHub integration performs deployments. Database/ontology changes must be backward compatible or have an explicit migration plan before promotion; a code rollback does not undo database writes.
