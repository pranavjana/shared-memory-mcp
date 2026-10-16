/** Connection setup only. The operating skill is installed separately. */
export function mcpInstallPrompt(resource: string): string {
  const origin = new URL(resource).origin;
  const prm = `${origin}/.well-known/oauth-protected-resource/mcp`;
  return `Install and connect the Shared Memory MCP server using the working OAuth recipe below.

Server name: Shared Memory
MCP endpoint: ${resource}
Transport: Streamable HTTP
Authentication: OAuth (Clerk)

Working OAuth recipe (required — this is what unblocked Muse):
- Discover auth from protected-resource metadata (${prm}), then load Clerk **oauth-authorization-server** metadata from authorization_servers (…/.well-known/oauth-authorization-server). Do **not** rely on OIDC discovery alone; it may omit registration_endpoint.
- Use Dynamic Client Registration: POST to registration_endpoint from AS metadata (Clerk: …/oauth/register). Public client with token_endpoint_auth_method=none and PKCE S256. Leave manually entered client ID and client secret blank for DCR.
- Send resource=${resource} on BOTH the authorization request and the token request, and retain that resource on refresh (RFC 8707). Without resource=, the access token has the wrong/missing audience and MCP returns invalid_token / audience mismatch.
- Request scopes: openid profile email offline_access (minimum required by this service: profile email; include openid and offline_access so hosts that need OIDC/refresh work — Muse needed all four). Never request public_metadata or private_metadata.

Scope of this task: configure the MCP connection and verify it works. Do not install skills, download SKILL.md, change agent or memory instructions, save example memories, share data, or start background monitoring. Skill installation is a separate step.

1. Identify the assistant host and its supported MCP configuration method. Inspect existing connections first. Reuse a Shared Memory entry pointing to ${resource} instead of creating duplicates. Preserve unrelated servers and settings. If you can configure MCP connections through a supported tool or local configuration, do so using the host's required permissions. If you cannot, give me the exact manual steps and state that installation is still pending. Do not invent a settings tool or claim that pasting this prompt installs anything by itself.

2. Configure a remote Streamable HTTP connection to ${resource} with OAuth using the working recipe above. Prefer DCR when registration_endpoint is advertised; CIMD is fine when client_id_metadata_document_supported is true. If the host supports only stdio, or blocks custom MCPs through workspace policy, report that limitation rather than silently changing transport or bypassing it — but only after confirming DCR, resource=, and scopes are correct.

3. Start the normal OAuth sign-in flow. I will sign in to my own Shared Memory account and approve the connection in the browser. Do not ask me to paste passwords, OTPs, access tokens, refresh tokens, or client secrets into chat or configuration. Never print or persist those credentials in plaintext; let the host handle its normal credential storage.

4. After login, reload the MCP connection if the host requires it, discover tools, and call get_connection_status. Confirm the account identity returned by the service with me; if it is unexpected, stop and help reconnect to the intended account. Do not infer success from a config file, plugin installation, or completed sign-in alone.

5. On 401 or 403: first check (a) DCR/public client registration, (b) resource=${resource} on authorize and token, (c) scopes include at least profile email (prefer openid profile email offline_access), (d) token audience matches ${resource}. Do not blame host admin / workspace policy until those are correct — a missing resource= or skipped DCR produces a malformed credential that looks like a policy failure. On audience mismatch, reconnect with DCR + resource=; do not loop new registrations or widen scopes alone. For invalid_scope, request only advertised scopes. For network/discovery errors, report the failing endpoint and status without credentials. Use bounded retries; never weaken audience checks or turn off authentication.

Finish with a short report: where the MCP connection was configured, whether tool discovery and get_connection_status succeeded, the account returned, and any exact action I still need to take. End with "MCP connected; skill installation is separate" only if the authenticated connection check actually succeeded.`;
}
