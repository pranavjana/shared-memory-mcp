/** Connection setup only. The operating skill is installed separately. */
export function mcpInstallPrompt(resource: string): string {
  const origin = new URL(resource).origin;
  return `Install and connect the Shared Memory MCP server in this assistant.

Server name: Shared Memory
MCP endpoint: ${resource}
Transport: Streamable HTTP
Authentication: OAuth
Required scopes: profile email
Protected resource metadata: ${origin}/.well-known/oauth-protected-resource/mcp

Scope: configure the MCP connection and verify it works. Do not install skills, download SKILL.md, change agent or memory instructions, save example memories, share data, or start background monitoring. Skill installation is a separate step.

1. Identify the assistant host and its supported MCP configuration method. Inspect existing connections first. Reuse a Shared Memory entry pointing to this endpoint instead of creating duplicates. Preserve unrelated servers and settings. If you can configure MCP connections through a supported tool or local configuration, do so using the host's required permissions. If you cannot, give me the exact manual steps and state that installation is still pending. Do not invent a settings tool or claim that pasting this prompt installs anything by itself.

2. Configure a remote Streamable HTTP connection with OAuth. Read the published protected-resource and authorization-server metadata rather than guessing OAuth endpoints. Use automatic client registration via the host's supported DCR or CIMD flow when advertised. Leave manually entered client ID and client secret blank for that flow. Do not request public_metadata or private_metadata scopes. Request openid or offline_access only when supported and needed by the host. If the host supports only stdio, or blocks custom MCPs through workspace policy, report the limitation rather than silently changing transport or bypassing it.

3. Start the normal OAuth sign-in flow. I will sign in to my own Shared Memory account and approve the connection in the browser. Do not ask me to paste passwords, OTPs, access tokens, refresh tokens, or client secrets into chat or configuration. Never print or persist those credentials in plaintext; let the host handle its normal credential storage.

4. The OAuth resource must be exactly ${resource}. Send resource=${resource} in BOTH the authorization request and token exchange, and retain the intended resource during refresh. A token intended for another audience must be rejected. If this host cannot pass the resource parameter, explain that compatibility blocker; do not turn off audience checks or authentication. Wider scopes do not fix a missing resource or audience.

5. Reload the MCP connection if the host requires it, discover its tools, and call get_connection_status. Confirm the account identity returned by the service with me; if it is unexpected, stop and help reconnect to the intended account. Do not infer successful connection from a config file, plugin installation, or completed sign-in alone. If approval or a host reload still needs my action, state that clearly.

6. Handle errors specifically: on 401 invalid_token, check resource/audience, token expiry, issuer and required scopes, then reconnect the existing entry if needed; do not loop through new client registrations. On revoked access or 403, direct me to re-enable the intended connection in the Shared Memory dashboard or contact the relevant administrator. For an invalid_scope error, request only the advertised supported scopes. For network or discovery errors, report the failing endpoint and status without credentials. Use bounded retries and do not weaken security settings to make a test pass.

Finish with a short report: where the MCP connection was configured, whether tool discovery and get_connection_status succeeded, the account returned, and any exact action I still need to take. End with "MCP connected; skill installation is separate" only if the authenticated connection check actually succeeded.`;
}
