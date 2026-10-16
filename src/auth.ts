import { createClerkClient } from '@clerk/express';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

export const requiredScopes = ['profile', 'email'];

/** Canonical MCP resource URL (RFC 8707). Always derived from the public origin. */
export function mcpResourceFromPublicUrl(publicUrl: string): string {
  return `${new URL(publicUrl).origin}/mcp`;
}

/** True when the token's aud claim includes the expected MCP resource. */
export function tokenAudienceMatches(
  aud: string[] | undefined,
  resource: string,
): boolean {
  return Array.isArray(aud) && aud.includes(resource);
}

/** Self-diagnosing detail for wrong or missing RFC 8707 audience. */
export function audienceMismatchMessage(resource: string): string {
  // Keep this ASCII-only: WWW-Authenticate must be a ByteString in Node HTTP.
  return (
    `invalid_token: audience mismatch - expected aud '${resource}'; ` +
    `clients must send resource=${resource} (RFC 8707) on authorization and token requests`
  );
}

export type TokenVerifyFailure = {
  ok: false;
  code: 'audience_mismatch' | 'invalid_token';
  message: string;
};

export type TokenVerifyResult =
  | { ok: true; auth: AuthInfo }
  | TokenVerifyFailure;

export type TokenVerifier = (token: string) => Promise<TokenVerifyResult>;

function invalidToken(message = 'invalid_token'): TokenVerifyFailure {
  return { ok: false, code: 'invalid_token', message };
}

function audienceMismatch(resource: string): TokenVerifyFailure {
  return {
    ok: false,
    code: 'audience_mismatch',
    message: audienceMismatchMessage(resource),
  };
}

function authFromVerified(
  token: string,
  verified: {
    clientId: string;
    scopes: string[];
    expiration: number | null;
    subject: string;
    aud?: string[];
    revoked: boolean;
    expired: boolean;
  },
  resource: string,
): TokenVerifyResult {
  if (!tokenAudienceMatches(verified.aud, resource)) {
    return audienceMismatch(resource);
  }
  if (
    verified.revoked ||
    verified.expired ||
    !verified.subject.startsWith('user_') ||
    !verified.expiration ||
    verified.expiration <= Date.now() / 1000 ||
    !requiredScopes.every((scope) => verified.scopes.includes(scope))
  ) {
    return invalidToken();
  }
  return {
    ok: true,
    auth: {
      token,
      clientId: verified.clientId,
      scopes: verified.scopes,
      expiresAt: verified.expiration,
      resource: new URL(resource),
      extra: { userId: verified.subject },
    },
  };
}

export function createClerkVerifier(
  secretKey: string,
  publishableKey: string,
  resource: string,
): TokenVerifier {
  const clerk = createClerkClient({ secretKey, publishableKey });
  return async (token) => {
    // Clerk's instance-scoped introspection checks validity and revocation.
    // Passing an audience also rejects tokens issued for another resource.
    try {
      const verified = await clerk.idPOAuthAccessToken.verify(token, {
        audience: resource,
      });
      return authFromVerified(token, verified, resource);
    } catch {
      // Diagnose missing/wrong aud without accepting the token for MCP use.
      try {
        const probed = await clerk.idPOAuthAccessToken.verify(token);
        if (!tokenAudienceMatches(probed.aud, resource)) {
          return audienceMismatch(resource);
        }
      } catch {
        // Fall through — never include a token or provider response in errors.
      }
      return invalidToken();
    }
  };
}
